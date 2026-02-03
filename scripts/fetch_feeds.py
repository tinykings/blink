import feedparser
import json
import logging
import re
import requests
import time
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

import pytz
from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Suppress specific warnings
warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)

# Configuration
TIMEZONE = 'America/Los_Angeles'
ITEMS_RETENTION_DAYS = 2
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
REQUEST_TIMEOUT = 30
MAX_WORKERS = 10
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1.0  # seconds


@dataclass
class FeedStats:
    """Track feed fetch statistics."""
    total: int = 0
    successful: int = 0
    failed: int = 0
    retried: int = 0
    failed_feeds: List[str] = field(default_factory=list)

    def record_success(self, url: str) -> None:
        self.successful += 1

    def record_failure(self, url: str, error: str) -> None:
        self.failed += 1
        self.failed_feeds.append(f"{url}: {error}")

    def record_retry(self) -> None:
        self.retried += 1

    def log_summary(self) -> None:
        logger.info(f"Feed fetch summary: {self.successful}/{self.total} successful, {self.failed} failed, {self.retried} retries")
        if self.failed_feeds:
            logger.warning(f"Failed feeds ({len(self.failed_feeds)}):")
            for feed_error in self.failed_feeds[:10]:  # Limit output
                logger.warning(f"  - {feed_error}")
            if len(self.failed_feeds) > 10:
                logger.warning(f"  ... and {len(self.failed_feeds) - 10} more")


class FeedProcessor:
    """Main class for processing RSS feeds and YouTube channels."""
    
    def __init__(self, timezone: str = TIMEZONE):
        self.timezone = timezone
        self.local_tz = pytz.timezone(timezone)
        self.utc_now = datetime.now(pytz.utc)
        self.session = requests.Session()
        self.session.headers.update({'User-Agent': USER_AGENT})
        
    def get_youtube_channel_info(self, url: str) -> Tuple[Optional[str], Optional[str]]:
        """Extract YouTube channel ID and name from URL."""
        logger.debug(f"Extracting YouTube channel info from: {url}")
        
        try:
            response = self.session.get(url, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')
            
            # Try to find channel ID
            channel_id = None
            meta_tag = soup.find('meta', itemprop='channelId')
            if meta_tag and meta_tag.get('content'):
                channel_id = meta_tag['content']
            
            # Fallback: extract from canonical URL
            if not channel_id:
                link_tag = soup.find('link', rel='canonical')
                if link_tag and link_tag.get('href'):
                    match = re.search(r'channel/(UC[\w-]+)', link_tag['href'])
                    if match:
                        channel_id = match.group(1)
            
            # Extract channel name
            channel_name = None
            title_tag = soup.find('title')
            if title_tag:
                title_text = title_tag.get_text().strip()
                channel_name = title_text.replace(' - YouTube', '').strip()
            
            return channel_id, channel_name
            
        except requests.RequestException as e:
            logger.error(f"Error fetching YouTube channel page {url}: {e}")
            return None, None
    
    def process_urls_file(self, file_path: str) -> List[str]:
        """Process URLs file and convert YouTube channels to RSS feeds."""
        logger.info(f"Processing URLs from {file_path}")
        
        try:
            with open(file_path, 'r') as f:
                lines = f.readlines()
        except FileNotFoundError:
            logger.error(f"URLs file {file_path} not found")
            return []
        
        rss_urls: List[str] = []
        youtube_entries: List[Tuple[str, Optional[str]]] = []
        youtube_rss_urls: List[Tuple[str, Optional[str]]] = []
        current_section = None
        pending_comment: Optional[str] = None

        # Parse file sections, preserving comments for YouTube entries
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith('#'):
                lowered = line.lower()
                if lowered == '#rss':
                    current_section = 'rss'
                    pending_comment = None
                elif lowered == '#youtube':
                    current_section = 'youtube'
                    pending_comment = None
                else:
                    if current_section == 'youtube':
                        pending_comment = line
                continue

            if current_section == 'rss':
                if 'youtube.com/feeds/videos.xml' in line:
                    youtube_rss_urls.append((line, None))
                else:
                    rss_urls.append(line)
            elif current_section == 'youtube':
                youtube_entries.append((line, pending_comment))
                pending_comment = None

        # Combine any YouTube RSS URLs found in the RSS section
        youtube_entries.extend(youtube_rss_urls)

        # Convert YouTube URLs to RSS feeds and collect channel names
        converted_entries: List[Tuple[str, str, Optional[str]]] = []
        
        to_convert = []
        for youtube_url, comment in youtube_entries:
            if 'youtube.com/feeds/videos.xml' in youtube_url:
                # Already an RSS feed; try to determine channel name
                match = re.search(r'channel_id=([\w-]+)', youtube_url)
                channel_id = match.group(1) if match else None
                channel_name = None
                if comment:
                    channel_name = comment.lstrip('#').strip()
                
                if channel_name:
                    converted_entries.append((youtube_url, youtube_url, channel_name))
                else:
                    to_convert.append((youtube_url, youtube_url, channel_id))
            else:
                to_convert.append((None, youtube_url, None))

        if to_convert:
            logger.info(f"Converting {len(to_convert)} YouTube URLs to RSS")
            with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                future_to_url = {
                    executor.submit(self.get_youtube_channel_info, 
                                   f"https://www.youtube.com/channel/{cid}" if cid else url): (rss_url, url)
                    for rss_url, url, cid in to_convert
                }
                for future in as_completed(future_to_url):
                    rss_url, original_url = future_to_url[future]
                    channel_id, channel_name = future.result()
                    
                    if not rss_url and channel_id:
                        rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
                    
                    if rss_url:
                        converted_entries.append((rss_url, original_url, channel_name))
                        if channel_name:
                            logger.info(f"Converted YouTube channel '{channel_name}' to RSS feed")
                    else:
                        converted_entries.append((original_url, original_url, channel_name))
                        logger.warning(f"Could not convert YouTube channel: {original_url}")
        
        # Return all RSS URLs
        all_rss_urls = rss_urls + [entry[0] for entry in converted_entries 
                                   if entry[0].startswith("https://www.youtube.com/feeds/videos.xml")]
        
        logger.info(f"Found {len(all_rss_urls)} RSS feeds to process")
        return all_rss_urls
    
    def fetch_single_feed(self, url: str, stats: Optional[FeedStats] = None) -> List[Dict[str, Any]]:
        """Fetch and parse a single RSS feed with retry logic."""
        last_error = None

        for attempt in range(MAX_RETRIES):
            try:
                response = self.session.get(url, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()

                feed = feedparser.parse(response.content)
                if feed.bozo and isinstance(feed.bozo_exception, Exception):
                    logger.warning(f"Parse error for {url}: {feed.bozo_exception}")
                    if not feed.entries:
                        if stats:
                            stats.record_failure(url, f"Parse error: {feed.bozo_exception}")
                        return []

                if stats:
                    stats.record_success(url)
                return self._process_feed_entries(feed, url)

            except requests.RequestException as e:
                last_error = str(e)
                if attempt < MAX_RETRIES - 1:
                    delay = RETRY_BASE_DELAY * (2 ** attempt)  # Exponential backoff
                    logger.debug(f"Retry {attempt + 1}/{MAX_RETRIES} for {url} after {delay}s")
                    if stats:
                        stats.record_retry()
                    time.sleep(delay)
                else:
                    logger.error(f"Error fetching feed {url} after {MAX_RETRIES} attempts: {e}")
            except Exception as e:
                last_error = str(e)
                logger.error(f"Error processing feed {url}: {e}")
                break

        if stats:
            stats.record_failure(url, last_error or "Unknown error")
        return []

    def fetch_feeds(self, urls: List[str]) -> Tuple[List[Dict[str, Any]], FeedStats]:
        """Fetch and parse RSS feeds from URLs in parallel."""
        logger.info(f"Fetching {len(urls)} feeds")
        all_items = []
        stats = FeedStats(total=len(urls))

        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            future_to_url = {executor.submit(self.fetch_single_feed, url, stats): url for url in urls}
            for i, future in enumerate(as_completed(future_to_url)):
                url = future_to_url[future]
                items = future.result()
                all_items.extend(items)
                if (i + 1) % 10 == 0 or (i + 1) == len(urls):
                    logger.info(f"Processed {i+1}/{len(urls)} feeds")

        stats.log_summary()
        logger.info(f"Fetched {len(all_items)} total items")
        return all_items, stats
    
    def _process_feed_entries(self, feed: feedparser.FeedParserDict, url: str) -> List[Dict[str, Any]]:
        """Process entries from a single feed."""
        items = []
        is_youtube_feed = 'youtube.com' in url
        cutoff_time = self.utc_now - timedelta(days=ITEMS_RETENTION_DAYS)

        for entry in feed.entries:
            item_id = entry.get('id') or entry.get('link')
            if not item_id:
                continue

            # Parse published time
            published_time = self._get_entry_time(entry)
            if published_time < cutoff_time:
                continue

            # Convert to local timezone
            published_time = published_time.astimezone(self.local_tz)

            # Extract thumbnail and video info
            thumbnail_url, video_id = self._extract_media_info(entry, is_youtube_feed)

            items.append({
                'id': item_id,
                'title': entry.title,
                'link': entry.link,
                'published': published_time,
                'thumbnail': thumbnail_url,
                'feed_title': getattr(feed.feed, 'title', ''),
                'video_id': video_id,
            })
        
        return items
    
    def _get_entry_time(self, entry: feedparser.FeedParserDict) -> datetime:
        """Extract published time from feed entry."""
        for time_attr in ['published_parsed', 'updated_parsed']:
            if hasattr(entry, time_attr) and getattr(entry, time_attr):
                return datetime(*getattr(entry, time_attr)[:6], tzinfo=pytz.utc)
        return self.utc_now
    
    def _extract_media_info(self, entry: feedparser.FeedParserDict, is_youtube: bool) -> Tuple[str, Optional[str]]:
        """Extract thumbnail URL and video ID from entry."""
        thumbnail_url = ''
        video_id = None
        
        if is_youtube:
            video_id = entry.get('yt_videoid')
            if not video_id:
                match = re.search(r"v=([^&]+)", entry.link)
                video_id = match.group(1) if match else None
        else:
            # Try various ways to find thumbnail
            if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
                thumbnail_url = entry.media_thumbnail[0]['url']
            else:
                # Look in content for image
                for content_attr in ['content']:
                    if hasattr(entry, content_attr):
                        content = getattr(entry, content_attr)
                        if isinstance(content, list):
                            content = content[0].value if content else ''
                        
                        soup = BeautifulSoup(str(content), 'lxml')
                        img_tag = soup.find('img')
                        if img_tag and img_tag.get('src'):
                            thumbnail_url = img_tag['src']
                            break
        
        return thumbnail_url, video_id
    
    def sort_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort items by published date."""
        return sorted(items, key=lambda x: x['published'], reverse=True)
    
    def process_items_for_display(self, items: List[Dict[str, Any]]) -> Tuple[str, str]:
        """Generate HTML and JSON for all items."""
        logger.info("Processing items for display")

        if not items:
            return "", "[]"

        # Generate HTML for all items
        html_snippet = self._generate_all_items_html(items)

        # Generate JSON for all items
        json_data = self._generate_all_items_json(items)

        return html_snippet, json_data

    def _generate_all_items_html(self, items: List[Dict[str, Any]]) -> str:
        """Generate HTML for all feed items."""
        html = ''
        for i, item in enumerate(items):
            html += self._generate_item_html(item, str(i))
        return html

    def _generate_item_html(self, item: Dict[str, Any], item_id: str) -> str:
        """Generate HTML for a single feed item."""
        html = f'<div class="feed-item" data-item-id="{item["id"]}">\n'
        
        # Add star icon placeholder
        html += f'<span class="star-icon" data-item-id="{item["id"]}">★</span>\n'

        # Add thumbnail/video placeholder
        if item['video_id']:
            thumbnail_url = f"https://img.youtube.com/vi/{item['video_id']}/sddefault.jpg"
            html += f'''<div class="video-placeholder" data-video-id="{item['video_id']}">
<img src="{thumbnail_url}" alt="Video Thumbnail" class="video-thumbnail" loading="lazy" decoding="async">
<div class="play-button"></div>
</div>
'''
        elif item['thumbnail']:
            html += f'<a href="{item["link"]}" target="_blank"><img src="{item["thumbnail"]}" alt="{item["title"]}" class="feed-thumbnail" loading="lazy" decoding="async"></a>\n'

        # Add item info (compact: omit published date and feed title)
        html += f'''<div class="feed-item-info">
<h2><a href="{item["link"]}" target="_blank">{item["title"]}</a></h2>
'''
        html += '</div>\n'

        html += '</div>\n'
        return html

    def _generate_all_items_json(self, items: List[Dict[str, Any]]) -> str:
        """Generate JSON data for all items."""
        serializable_items = []
        for item in items:
            item_copy = item.copy()
            item_copy['published'] = item['published'].strftime("%Y-%m-%d %H:%M:%S")
            serializable_items.append(item_copy)
        return json.dumps(serializable_items, indent=2)
    
    def update_html_file(self, html_snippet: str, json_data: str, template_path: str = 'index.template.html', output_path: str = 'index.html') -> None:
        """Update the HTML file with feed data."""
        logger.info(f"Updating {output_path}")
        
        try:
            with open(template_path, 'r', encoding='utf-8') as f:
                template = f.read()
        except FileNotFoundError:
            logger.error(f"Template file {template_path} not found")
            return
        
        # Replace placeholders
        template = template.replace('<div id="feed-container"></div>', f'<div id="feed-container">{html_snippet}</div>')
        
        # Add JSON data
        json_script = f'<script id="feed-data" type="application/json">{json_data}</script>'
        template = template.replace('</body>', f'{json_script}\n</body>')
        
        # Update timestamp
        now = self.utc_now.astimezone(self.local_tz)
        timestamp = now.strftime("%m-%d %I:%M")
        last_updated_text = f"{timestamp} | {ITEMS_RETENTION_DAYS}d"
        template = template.replace('<!-- last_updated_placeholder -->', last_updated_text)
        
        try:
            with open(output_path, 'w', encoding='utf-8') as f:
                f.write(template)
            logger.info(f"Successfully updated {output_path}")
        except IOError as e:
            logger.error(f"Could not write {output_path}: {e}")


def main():
    """Main execution function."""
    processor = FeedProcessor()

    # Process URLs and fetch feeds
    feed_urls = processor.process_urls_file('feeds.txt')
    feed_items, stats = processor.fetch_feeds(feed_urls)
    sorted_items = processor.sort_items(feed_items)

    # Generate HTML and JSON
    html_snippet, json_data = processor.process_items_for_display(sorted_items)

    # Update HTML file
    processor.update_html_file(html_snippet, json_data)

    logger.info(f"Successfully processed {len(sorted_items)} items")
    if stats.failed > 0:
        logger.warning(f"Note: {stats.failed} feeds failed to fetch")


if __name__ == "__main__":
    main()
