import feedparser
import json
import logging
import re
import requests
import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

import pytz
from bs4 import BeautifulSoup, MarkupResemblesLocatorWarning

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Suppress specific warnings
warnings.filterwarnings("ignore", category=MarkupResemblesLocatorWarning)

# Configuration
TIMEZONE = 'America/Los_Angeles'
ITEMS_RETENTION_DAYS = 5
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
REQUEST_TIMEOUT = 30


class FeedProcessor:
    """Main class for processing RSS feeds and YouTube channels."""
    
    def __init__(self, timezone: str = TIMEZONE):
        self.timezone = timezone
        self.local_tz = pytz.timezone(timezone)
        self.utc_now = datetime.now(pytz.utc)
        
    def get_youtube_channel_info(self, url: str) -> Tuple[Optional[str], Optional[str]]:
        """Extract YouTube channel ID and name from URL."""
        logger.debug(f"Extracting YouTube channel info from: {url}")
        
        try:
            response = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'html.parser')
            
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
        youtube_log_entries: List[Tuple[str, str]] = []

        for youtube_url, comment in youtube_entries:
            channel_name: Optional[str] = None

            if 'youtube.com/feeds/videos.xml' in youtube_url:
                # Already an RSS feed; try to determine channel name
                match = re.search(r'channel_id=([\w-]+)', youtube_url)
                channel_id = match.group(1) if match else None
                if comment:
                    channel_name = comment.lstrip('#').strip()
                elif channel_id:
                    _, channel_name = self.get_youtube_channel_info(
                        f"https://www.youtube.com/channel/{channel_id}"
                    )
                converted_entries.append((youtube_url, youtube_url, channel_name))
                continue

            channel_id, channel_name = self.get_youtube_channel_info(youtube_url)
            if channel_id:
                rss_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
                converted_entries.append((rss_url, youtube_url, channel_name))
                youtube_log_entries.append((channel_id, channel_name))
                logger.info(
                    f"Converted YouTube channel '{channel_name}' to RSS feed"
                )
            else:
                converted_entries.append((youtube_url, youtube_url, channel_name))
                logger.warning(
                    f"Could not convert YouTube channel: {youtube_url}"
                )
        
        # Write YouTube log
        self._write_youtube_log(youtube_log_entries)
        
        # Update feeds.txt file
        self._update_feeds_file(file_path, rss_urls, converted_entries)
        
        # Return all RSS URLs
        all_rss_urls = rss_urls + [entry[0] for entry in converted_entries 
                                   if entry[0].startswith("https://www.youtube.com/feeds/videos.xml")]
        
        logger.info(f"Found {len(all_rss_urls)} RSS feeds to process")
        return all_rss_urls
    
    def _write_youtube_log(self, entries: List[Tuple[str, str]]) -> None:
        """Write YouTube channel info to log file."""
        try:
            with open('yt.log', 'w') as f:
                for channel_id, channel_name in entries:
                    f.write(f"{channel_id}: {channel_name}\n")
        except IOError as e:
            logger.error(f"Could not write YouTube log: {e}")
    
    def _update_feeds_file(
        self,
        file_path: str,
        rss_urls: List[str],
        converted_entries: List[Tuple[str, str, Optional[str]]],
    ) -> None:
        """Update the feeds.txt file with converted YouTube URLs."""
        try:
            with open(file_path, 'w') as f:
                f.write("#rss\n")

                # Write original non-YouTube RSS URLs
                for url in rss_urls:
                    f.write(f"{url}\n")

                # Write YouTube feeds under their own section
                f.write("\n#youtube\n")
                for rss_url, original_url, channel_name in converted_entries:
                    if rss_url.startswith("https://www.youtube.com/feeds/videos.xml"):
                        name = channel_name or 'Unknown channel'
                        f.write(f"# {name}\n")
                        f.write(f"{rss_url}\n")
                    else:
                        if channel_name:
                            f.write(f"# {channel_name}\n")
                        f.write(f"{original_url}\n")
        except IOError as e:
            logger.error(f"Could not update feeds file: {e}")
    
    def fetch_feeds(self, urls: List[str]) -> List[Dict[str, Any]]:
        """Fetch and parse RSS feeds from URLs."""
        logger.info(f"Fetching {len(urls)} feeds")
        all_items = []
        
        for i, url in enumerate(urls):
            logger.info(f"Processing feed {i+1}/{len(urls)}: {url}")
            try:
                response = requests.get(url, headers={'User-Agent': USER_AGENT}, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                
                feed = feedparser.parse(response.content)
                if feed.bozo and isinstance(feed.bozo_exception, Exception):
                    logger.warning(f"Parse error for {url}: {feed.bozo_exception}")
                    if not feed.entries:
                        continue
                
                items = self._process_feed_entries(feed, url)
                all_items.extend(items)
                
            except requests.RequestException as e:
                logger.error(f"Error fetching feed {url}: {e}")
            except Exception as e:
                logger.error(f"Error processing feed {url}: {e}")
        
        logger.info(f"Fetched {len(all_items)} total items")
        return all_items
    
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
            
            # Determine if item is about to be removed within the next day
            # We flag items that are at least ITEMS_RETENTION_DAYS days old
            is_leaving_soon = (
                self.utc_now - published_time
            ) >= timedelta(days=ITEMS_RETENTION_DAYS)

            # Convert to local timezone
            published_time = published_time.astimezone(self.local_tz)

            # Extract thumbnail and video info
            thumbnail_url, video_id = self._extract_media_info(entry, is_youtube_feed)

            # Extract summary
            summary = self._extract_summary(entry)

            items.append({
                'id': item_id,
                'title': entry.title,
                'link': entry.link,
                'published': published_time,
                'thumbnail': thumbnail_url,
                'feed_title': getattr(feed.feed, 'title', ''),
                'summary': summary,
                'video_id': video_id,
                'leaving_soon': is_leaving_soon,
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
                # Look in content or summary
                for content_attr in ['content', 'summary']:
                    if hasattr(entry, content_attr):
                        content = getattr(entry, content_attr)
                        if isinstance(content, list):
                            content = content[0].value if content else ''
                        
                        soup = BeautifulSoup(str(content), 'html.parser')
                        img_tag = soup.find('img')
                        if img_tag and img_tag.get('src'):
                            thumbnail_url = img_tag['src']
                            break
        
        return thumbnail_url, video_id
    
    def _extract_summary(self, entry: feedparser.FeedParserDict) -> str:
        """Extract clean text summary from entry."""
        if not hasattr(entry, 'summary'):
            return ''
        
        soup = BeautifulSoup(entry.summary, 'html.parser')
        return soup.get_text(strip=True)
    
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

        # Add thumbnail/video placeholder
        if item['video_id']:
            thumbnail_url = f"https://img.youtube.com/vi/{item['video_id']}/hqdefault.jpg"
            html += f'''<div class="video-placeholder" data-video-id="{item['video_id']}">
<img src="{thumbnail_url}" alt="Video Thumbnail" class="video-thumbnail">
<div class="play-button"></div>
</div>
'''
        elif item['thumbnail']:
            html += f'<a href="{item["link"]}" target="_blank"><img src="{item["thumbnail"]}" alt="{item["title"]}" class="feed-thumbnail"></a>\n'

        # Add item info
        published_str = item["published"].strftime("%Y-%m-%d %H:%M:%S") if isinstance(item["published"], datetime) else str(item["published"])

        html += f'''<div class="feed-item-info">
<h2><a href="{item["link"]}" target="_blank">{item["title"]}</a></h2>
<p class="published-date">{published_str}</p>
<p class="feed-title">{item["feed_title"]}</p>
'''
        if item.get('leaving_soon'):
            html += '<p class="leaving-soon">⏰ Leaving soon</p>\n'

        if item['summary']:
            html += f'''<button class="toggle-summary-btn" data-target="summary-{item_id}">...</button>
<div id="summary-{item_id}" class="summary" style="display: none;">{item["summary"]}</div>
'''

        html += '</div>\n</div>\n'
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
    feed_items = processor.fetch_feeds(feed_urls)
    sorted_items = processor.sort_items(feed_items)
    
    # Generate HTML and JSON
    html_snippet, json_data = processor.process_items_for_display(sorted_items)
    
    # Update HTML file
    processor.update_html_file(html_snippet, json_data)
    
    logger.info(f"Successfully processed {len(sorted_items)} items")


if __name__ == "__main__":
    main()
