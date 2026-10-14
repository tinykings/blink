import feedparser
import json
import logging
import re
import requests
import time
import threading
import warnings
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from urllib.parse import urlsplit
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
ITEMS_RETENTION_DAYS = 5
# Defaults used when feeds.txt has no app settings block.
INCLUDE_YOUTUBE_SHORTS = False
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
REQUEST_TIMEOUT = 30
MAX_WORKERS = 10
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2.0  # seconds
# GitHub-hosted runners share IP ranges. Sending hundreds of requests at once
# makes YouTube return transient 404/500 responses and Reddit return 429.
HOST_REQUEST_INTERVALS = {
    'youtube.com': 0.5,
    'reddit.com': 6.5,
}
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


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
        self._host_locks: Dict[str, threading.Lock] = {}
        self._host_locks_guard = threading.Lock()
        self._host_next_request: Dict[str, float] = {}
        self.feed_title_overrides: Dict[str, str] = {}
        self.include_youtube_shorts: Optional[bool] = None

    def youtube_shorts_enabled(self) -> bool:
        return INCLUDE_YOUTUBE_SHORTS if self.include_youtube_shorts is None else self.include_youtube_shorts

    def _host_interval(self, hostname: str) -> float:
        for domain, interval in HOST_REQUEST_INTERVALS.items():
            if hostname == domain or hostname.endswith(f'.{domain}'):
                return interval
        return 0.0

    def _get_host_lock(self, hostname: str) -> threading.Lock:
        with self._host_locks_guard:
            return self._host_locks.setdefault(hostname, threading.Lock())

    def _request(self, url: str) -> requests.Response:
        """GET a URL while pacing requests to rate-sensitive hosts."""
        hostname = (urlsplit(url).hostname or '').lower()
        interval = self._host_interval(hostname)
        if not interval:
            return self.session.get(url, timeout=REQUEST_TIMEOUT)

        # Keep each sensitive host serialized. This also avoids concurrent use
        # of one Session against hosts which set anti-abuse cookies.
        with self._get_host_lock(hostname):
            wait = self._host_next_request.get(hostname, 0.0) - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            try:
                return self.session.get(url, timeout=REQUEST_TIMEOUT)
            finally:
                self._host_next_request[hostname] = time.monotonic() + interval

    @staticmethod
    def _should_retry(url: str, error: requests.RequestException) -> bool:
        response = getattr(error, 'response', None)
        if response is None:
            return True
        if response.status_code in RETRYABLE_STATUS_CODES:
            return True
        # YouTube uses 404 as an overload/anti-abuse response even for known,
        # valid channel IDs. A paced retry commonly succeeds.
        return response.status_code == 404 and 'youtube.com/feeds/' in url

    @staticmethod
    def _retry_delay(error: requests.RequestException, attempt: int) -> float:
        response = getattr(error, 'response', None)
        retry_after = response.headers.get('Retry-After') if response is not None else None
        try:
            return min(60.0, max(float(retry_after), RETRY_BASE_DELAY * (2 ** attempt)))
        except (TypeError, ValueError):
            return RETRY_BASE_DELAY * (2 ** attempt)
        
    def get_youtube_channel_info(self, url: str) -> Tuple[Optional[str], Optional[str]]:
        """Extract YouTube channel ID and name from URL."""
        logger.debug(f"Extracting YouTube channel info from: {url}")

        try:
            response = self._request(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.text, 'lxml')

            # Try to find channel ID using multiple strategies
            channel_id = None

            # Strategy 1: meta itemprop tag
            meta_tag = soup.find('meta', itemprop='channelId')
            if meta_tag and meta_tag.get('content'):
                channel_id = meta_tag['content']

            # Strategy 2: canonical URL
            if not channel_id:
                link_tag = soup.find('link', rel='canonical')
                if link_tag and link_tag.get('href'):
                    match = re.search(r'channel/(UC[\w-]+)', link_tag['href'])
                    if match:
                        channel_id = match.group(1)

            # Strategy 3: og:url or twitter:url meta tags
            if not channel_id:
                for prop in ['og:url', 'twitter:url']:
                    meta = soup.find('meta', attrs={'property': prop}) or soup.find('meta', attrs={'name': prop})
                    if meta and meta.get('content'):
                        match = re.search(r'channel/(UC[\w-]+)', meta['content'])
                        if match:
                            channel_id = match.group(1)
                            break

            # Strategy 4: externalId in inline JSON data
            if not channel_id:
                match = re.search(r'"externalId"\s*:\s*"(UC[\w-]+)"', response.text)
                if match:
                    channel_id = match.group(1)

            # Extract channel name
            channel_name = None
            title_tag = soup.find('title')
            if title_tag:
                title_text = title_tag.get_text().strip()
                channel_name = title_text.replace(' - YouTube', '').strip()

            if channel_id:
                return channel_id, channel_name

        except requests.RequestException as e:
            logger.warning(f"HTML scrape failed for {url}: {e}")

        # Fallback: try the /videos page which may have different HTML
        try:
            handle_match = re.search(r'youtube\.com/(@[\w.-]+)', url)
            if handle_match:
                resolve_url = f"https://www.youtube.com/{handle_match.group(1)}/videos"
                response = self._request(resolve_url)
                match = re.search(r'"externalId"\s*:\s*"(UC[\w-]+)"', response.text)
                if not match:
                    match = re.search(r'channel/(UC[\w-]+)', response.text)
                if match:
                    channel_id = match.group(1)
                    logger.info(f"Resolved channel ID via fallback for {url}: {channel_id}")
                    return channel_id, None
        except requests.RequestException as e:
            logger.warning(f"Fallback resolution failed for {url}: {e}")

        logger.error(f"Could not extract channel ID from {url}")
        return None, None
    
    def process_urls_file(self, file_path: str) -> List[str]:
        """Process URLs file and convert YouTube channels to RSS feeds."""
        logger.info(f"Processing URLs from {file_path}")
        self.feed_title_overrides = {}
        
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

        # Parse file sections, preserving comments as display names.
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith('#'):
                lowered = line.lower()
                if lowered == '#settings':
                    current_section = 'settings'
                    pending_comment = None
                elif lowered == '#rss':
                    current_section = 'rss'
                    pending_comment = None
                elif lowered == '#youtube':
                    current_section = 'youtube'
                    pending_comment = None
                else:
                    pending_comment = line
                continue

            if current_section == 'settings':
                key, _, value = line.partition('=')
                setting_key = key.strip().lower()
                enabled = value.strip().lower() in ('1', 'true', 'yes', 'on')
                if setting_key == 'include_youtube_shorts':
                    self.include_youtube_shorts = enabled
                elif setting_key == 'disable_shorts':
                    self.include_youtube_shorts = not enabled
                continue
            if current_section == 'rss':
                if 'youtube.com/feeds/videos.xml' in line:
                    youtube_rss_urls.append((line, pending_comment))
                else:
                    rss_urls.append(line)
                    if pending_comment:
                        self.feed_title_overrides[line] = pending_comment.lstrip('#').strip()
                pending_comment = None
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
        
        # Write back converted YouTube URLs to feeds.txt
        self._update_feeds_file(file_path, converted_entries)

        # Use channel feeds. YouTube no longer reliably serves the generated
        # UULF long-form playlist feeds; Shorts are filtered per entry below.
        youtube_feed_urls = []
        for url, _, channel_name in converted_entries:
            if not url.startswith("https://www.youtube.com/feeds/videos.xml"):
                continue
            youtube_feed_urls.append(url)
            if channel_name:
                self.feed_title_overrides[url] = channel_name

        if not self.youtube_shorts_enabled():
            logger.info("YouTube Shorts disabled; filtering channel feed entries")

        all_rss_urls = rss_urls + youtube_feed_urls

        logger.info(f"Found {len(all_rss_urls)} RSS feeds to process")
        return all_rss_urls
    
    def _update_feeds_file(self, file_path: str, converted_entries: List[Tuple[str, str, Optional[str]]]) -> None:
        """Replace YouTube channel URLs in feeds.txt with their RSS feed equivalents."""
        # Build a map from original channel URL -> (rss_url, channel_name)
        replacements = {}
        for rss_url, original_url, channel_name in converted_entries:
            if original_url == rss_url:
                continue
            if not rss_url.startswith("https://www.youtube.com/feeds/videos.xml"):
                continue
            replacements[original_url] = (rss_url, channel_name)

        if not replacements:
            return

        try:
            with open(file_path, 'r') as f:
                lines = f.readlines()
        except FileNotFoundError:
            return

        new_lines = []
        for line in lines:
            stripped = line.strip()
            if stripped in replacements:
                rss_url, channel_name = replacements[stripped]
                previous_is_name = bool(
                    new_lines
                    and new_lines[-1].lstrip().startswith('#')
                    and new_lines[-1].strip().lower() not in ('#rss', '#youtube')
                )
                if channel_name and not previous_is_name:
                    new_lines.append(f"# {channel_name}\n")
                new_lines.append(f"{rss_url}\n")
                logger.info(f"Updated feeds.txt: {stripped} -> {rss_url}")
            else:
                new_lines.append(line)

        try:
            with open(file_path, 'w') as f:
                f.writelines(new_lines)
            logger.info(f"Saved updated feeds to {file_path}")
        except IOError as e:
            logger.error(f"Could not update {file_path}: {e}")

    @staticmethod
    def _youtube_text(value: Any) -> str:
        if not isinstance(value, dict):
            return ''
        if value.get('simpleText'):
            return value['simpleText']
        return ''.join(run.get('text', '') for run in value.get('runs', []))

    def _youtube_relative_time(self, text: str) -> Optional[datetime]:
        """Convert YouTube's relative publish label to an approximate UTC time."""
        lowered = text.lower().replace('streamed ', '').replace('premiered ', '')
        if lowered == 'yesterday':
            return self.utc_now - timedelta(days=1)
        match = re.search(
            r'(\d+)\s*(minute|min|hour|hr|day|week|wk|month|mo|year|yr|[mhdw])s?\s+ago',
            lowered,
        )
        if not match:
            return self.utc_now if any(word in lowered for word in ('live', 'premiere')) else None
        amount = int(match.group(1))
        unit = match.group(2)
        if unit in ('minute', 'min', 'm'):
            return self.utc_now - timedelta(minutes=amount)
        if unit in ('hour', 'hr', 'h'):
            return self.utc_now - timedelta(hours=amount)
        if unit in ('day', 'd'):
            return self.utc_now - timedelta(days=amount)
        if unit in ('week', 'wk', 'w'):
            return self.utc_now - timedelta(weeks=amount)
        if unit in ('month', 'mo'):
            return self.utc_now - timedelta(days=30 * amount)
        return self.utc_now - timedelta(days=365 * amount)

    def _process_youtube_initial_data(self, data: Dict[str, Any], url: str,
                                      channel_name: str) -> List[Dict[str, Any]]:
        items = []
        seen = set()
        cutoff_time = self.utc_now - timedelta(days=ITEMS_RETENTION_DAYS)

        def add_item(video_id: str, title: str, published_label: str) -> None:
            if not video_id or video_id in seen or not title:
                return
            published = self._youtube_relative_time(published_label)
            if published is None or published < cutoff_time:
                return
            seen.add(video_id)
            items.append({
                'id': f'yt:video:{video_id}',
                'title': title,
                'link': f'https://www.youtube.com/watch?v={video_id}',
                'published': published.astimezone(self.local_tz),
                'thumbnail': '',
                'feed_title': self.feed_title_overrides.get(url) or channel_name,
                'video_id': video_id,
                'description': '',
            })

        def walk(value: Any) -> None:
            if isinstance(value, list):
                for child in value:
                    walk(child)
                return
            if not isinstance(value, dict):
                return

            renderer = value.get('videoRenderer')
            if renderer:
                add_item(
                    renderer.get('videoId', ''),
                    self._youtube_text(renderer.get('title')),
                    self._youtube_text(renderer.get('publishedTimeText')),
                )
                return

            lockup = value.get('lockupViewModel')
            if lockup and lockup.get('contentType') == 'LOCKUP_CONTENT_TYPE_VIDEO':
                metadata = lockup.get('metadata', {}).get('lockupMetadataViewModel', {})
                rows = (metadata.get('metadata', {}).get('contentMetadataViewModel', {})
                        .get('metadataRows', []))
                labels = [
                    part.get('text', {}).get('content', '')
                    for row in rows
                    for part in row.get('metadataParts', [])
                ]
                published_label = next(
                    (label for label in reversed(labels)
                     if re.search(r'ago|yesterday|live|premiere', label, re.I)),
                    '',
                )
                add_item(
                    lockup.get('contentId', ''),
                    metadata.get('title', {}).get('content', ''),
                    published_label,
                )
                return

            for child in value.values():
                walk(child)

        walk(data)
        return items

    def _fetch_youtube_html(self, url: str) -> Optional[List[Dict[str, Any]]]:
        """Fallback for YouTube's intermittently unavailable Atom endpoint."""
        match = re.search(r'channel_id=(UC[\w-]+)', url)
        if not match:
            return None
        channel_url = f'https://www.youtube.com/channel/{match.group(1)}/videos'
        try:
            response = self._request(channel_url)
            response.raise_for_status()
            initial_data = re.search(r'var ytInitialData = ({.*?});</script>', response.text, re.S)
            if not initial_data:
                return None
            data = json.loads(initial_data.group(1))
            title_match = re.search(r'<title>(.*?)</title>', response.text, re.S)
            channel_name = BeautifulSoup(
                title_match.group(1), 'html.parser'
            ).get_text().replace(' - YouTube', '').strip() if title_match else ''
            return self._process_youtube_initial_data(data, url, channel_name)
        except (requests.RequestException, json.JSONDecodeError, ValueError) as e:
            logger.warning(f"YouTube HTML fallback failed for {url}: {e}")
            return None

    def fetch_single_feed(self, url: str, stats: Optional[FeedStats] = None) -> List[Dict[str, Any]]:
        """Fetch and parse a single RSS feed with retry logic."""
        last_error = None

        for attempt in range(MAX_RETRIES):
            try:
                response = self._request(url)
                response.raise_for_status()

                feed = feedparser.parse(response.content)
                if feed.bozo and isinstance(feed.bozo_exception, Exception):
                    logger.warning(f"Parse error for {url}: {feed.bozo_exception}")
                    if not feed.entries:
                        if stats:
                            stats.record_failure(url, f"Parse error: {feed.bozo_exception}")
                        return []

                items = self._process_feed_entries(feed, url)
                if stats:
                    stats.record_success(url)
                return items

            except requests.RequestException as e:
                last_error = str(e)
                if 'youtube.com/feeds/' in url:
                    fallback_items = self._fetch_youtube_html(url)
                    if fallback_items is not None:
                        logger.warning(
                            f"Used YouTube HTML fallback for {url} ({len(fallback_items)} items)"
                        )
                        if stats:
                            stats.record_success(url)
                        return fallback_items
                retry = attempt < MAX_RETRIES - 1 and self._should_retry(url, e)
                if retry:
                    delay = self._retry_delay(e, attempt)
                    logger.debug(f"Retry {attempt + 1}/{MAX_RETRIES} for {url} after {delay}s")
                    if stats:
                        stats.record_retry()
                    time.sleep(delay)
                else:
                    attempts = attempt + 1
                    logger.error(f"Error fetching feed {url} after {attempts} attempt(s): {e}")
                    break
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
            try:
                item_id = entry.get('id') or entry.get('link')
                link = entry.get('link')
                if not item_id or not link:
                    logger.warning(f"Skipping entry without ID or link from {url}")
                    continue

                # Playlists can still contain Shorts; also check each entry's URL.
                if (is_youtube_feed and not self.youtube_shorts_enabled()
                        and urlsplit(link).path.startswith('/shorts/')):
                    continue

                # Parse published time
                published_time = self._get_entry_time(entry)
                if published_time < cutoff_time:
                    continue

                # Convert to local timezone
                published_time = published_time.astimezone(self.local_tz)

                # Extract thumbnail, video info, and YouTube description
                thumbnail_url, video_id, yt_desc = self._extract_media_info(entry, is_youtube_feed)

                # Clean description text (prefer YouTube description if available)
                description = yt_desc if yt_desc else self._clean_description(entry)

                items.append({
                    'id': item_id,
                    'title': entry.get('title') or 'Untitled',
                    'link': link,
                    'published': published_time,
                    'thumbnail': thumbnail_url,
                    'feed_title': self.feed_title_overrides.get(url) or getattr(feed.feed, 'title', ''),
                    'video_id': video_id,
                    'description': description,
                })
            except Exception as e:
                entry_ref = entry.get('id') or entry.get('link') or 'unknown entry'
                logger.warning(f"Skipping malformed entry {entry_ref} from {url}: {e}")
        
        return items
    
    def _get_entry_time(self, entry: feedparser.FeedParserDict) -> datetime:
        """Extract published time from feed entry."""
        for time_attr in ['published_parsed', 'updated_parsed']:
            if hasattr(entry, time_attr) and getattr(entry, time_attr):
                return datetime(*getattr(entry, time_attr)[:6], tzinfo=pytz.utc)
        return self.utc_now
    
    def _extract_media_info(self, entry: feedparser.FeedParserDict, is_youtube: bool) -> Tuple[str, Optional[str], str]:
        """Extract thumbnail URL, video ID, and description from entry."""
        thumbnail_url = ''
        video_id = None
        description = ''
        
        if is_youtube:
            video_id = entry.get('yt_videoid')
            if not video_id:
                match = re.search(r"v=([^&]+)", entry.link)
                video_id = match.group(1) if match else None
            
            # Extract YouTube description from media:description or media:group
            if hasattr(entry, 'media_description') and entry.media_description:
                description = entry.media_description
            elif hasattr(entry, 'media_group') and entry.media_group:
                media_group = entry.media_group
                if hasattr(media_group, 'media_description') and media_group.media_description:
                    description = media_group.media_description
                elif isinstance(media_group, dict) and media_group.get('media_description'):
                    description = media_group['media_description']
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
        
        return thumbnail_url, video_id, description

    def _clean_description(self, entry: feedparser.FeedParserDict) -> str:
        """Extract and clean description/summary text from entry."""
        text = ''
        
        # Try summary/summary_detail first
        if hasattr(entry, 'summary') and entry.summary:
            text = entry.summary
        elif hasattr(entry, 'summary_detail') and entry.summary_detail and entry.summary_detail.get('value'):
            text = entry.summary_detail['value']
        
        # Fallback to content if no summary
        if not text and hasattr(entry, 'content'):
            content = entry.content
            if isinstance(content, list) and content:
                text = content[0].value if hasattr(content[0], 'value') else str(content[0])
            elif hasattr(content, 'value'):
                text = content.value
        
        if not text:
            return ''
        
        # Parse HTML
        soup = BeautifulSoup(text, 'lxml')
        
        # Remove dangerous tags
        for tag in soup(['script', 'style', 'noscript', 'iframe', 'object', 'embed', 'form', 'input']):
            tag.decompose()
        
        # Remove dangerous attributes
        allowed_tags = {'br', 'p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div'}
        for tag in soup.find_all(True):
            if tag.name not in allowed_tags:
                tag.unwrap()
            # Remove event handlers and other dangerous attributes
            attrs_to_remove = [attr for attr in tag.attrs if attr.startswith('on') or attr in ['style', 'class', 'id']]
            for attr in attrs_to_remove:
                del tag[attr]
        
        # Get HTML with preserved formatting
        html = str(soup)
        
        # Clean up whitespace while preserving paragraph breaks
        html = re.sub(r'<br\s*/?>\s*</p>', '</p>', html)
        html = re.sub(r'<p>\s*</p>', '', html)
        html = re.sub(r'\s+', ' ', html)
        html = html.strip()
        
        # Limit length - truncate at word boundary
        max_len = 500
        if len(html) > max_len:
            # Find text content length for truncation
            text_only = soup.get_text()
            if len(text_only) > max_len:
                # Get plain text for truncation
                text_parts = []
                current_len = 0
                for element in soup.find_all(string=True):
                    text_parts.append(str(element))
                    current_len += len(element)
                    if current_len >= max_len:
                        break
                
                # Rebuild with truncation
                result_soup = BeautifulSoup('', 'lxml')
                for part in text_parts:
                    result_soup.append(part)
                
                html = str(result_soup)
                # Find last space to break at word
                if len(html) > max_len:
                    cutoff = html[:max_len]
                    last_space = cutoff.rfind(' ')
                    if last_space > max_len * 0.6:
                        html = html[:last_space] + '...'
                    else:
                        html = html[:max_len] + '...'
        
        return html
    
    def sort_items(self, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sort items by published date."""
        return sorted(items, key=lambda x: x['published'], reverse=True)
    
    def process_items_for_display(self, items: List[Dict[str, Any]]) -> str:
        """Generate JSON for all items."""
        logger.info("Processing items for display")

        if not items:
            return "[]"

        return self._generate_all_items_json(items)

    def _generate_all_items_json(self, items: List[Dict[str, Any]]) -> str:
        """Generate JSON data for all items."""
        serializable_items = []
        for item in items:
            item_copy = item.copy()
            item_copy['published'] = item['published'].isoformat()
            serializable_items.append(item_copy)
        return json.dumps(serializable_items, indent=2)
    
    def update_html_file(self, json_data: str, template_path: str = 'index.template.html', output_path: str = 'index.html') -> None:
        """Update the HTML file with feed data."""
        logger.info(f"Updating {output_path}")

        try:
            with open(template_path, 'r', encoding='utf-8') as f:
                template = f.read()
        except FileNotFoundError:
            logger.error(f"Template file {template_path} not found")
            return

        # Add JSON data
        json_script = f'<script id="feed-data" type="application/json">{json_data}</script>'
        template = template.replace('</body>', f'{json_script}\n</body>')
        
        # Update timestamp
        now = self.utc_now.astimezone(self.local_tz)
        last_updated_text = now.strftime("%I:%M")
        template = template.replace('<!-- last_updated_placeholder -->', last_updated_text)
        template = template.replace('<!-- items_retention_days_placeholder -->', str(ITEMS_RETENTION_DAYS))
        template = template.replace('<!-- disable_shorts_placeholder -->', str(not self.youtube_shorts_enabled()).lower())
        
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

    # Generate JSON
    json_data = processor.process_items_for_display(sorted_items)

    # Update HTML file
    processor.update_html_file(json_data)

    logger.info(f"Successfully processed {len(sorted_items)} items")
    if stats.failed > 0:
        logger.warning(f"Note: {stats.failed} feeds failed to fetch")


if __name__ == "__main__":
    main()
