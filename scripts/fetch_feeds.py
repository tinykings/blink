import feedparser
import json
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
import os
import re
import requests
import pytz

# Configuration
TIMEZONE = 'America/Los_Angeles'

def get_channel_id_from_url(url):
    """Extracts the channel ID from a YouTube channel URL."""
    print(f"  Extracting YouTube channel ID from: {url}") 
    try:
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        
        meta_tag = soup.find('meta', itemprop='channelId')
        if meta_tag and meta_tag.has_attr('content'):
            return meta_tag['content']
            
        link_tag = soup.find('link', rel='canonical')
        if link_tag and link_tag.has_attr('href'):
            match = re.search(r'channel/(UC[\w-]+)', link_tag['href'])
            if match:
                return match.group(1)

    except requests.exceptions.RequestException as e:
        print(f"Error fetching YouTube channel page: {e}")
    return None

def read_urls_from_file(file_path):
    """Reads URLs from a text file, parsing sections for RSS and YouTube."""
    print(f"Reading URLs from {file_path}...")
    urls = []
    with open(file_path, 'r') as f:
        current_section = None
        for line in f:
            line = line.strip()
            if not line:
                continue
            if line.lower() == '#rss':
                current_section = 'rss'
            elif line.lower() == '#youtube':
                current_section = 'youtube'
            elif current_section == 'rss':
                urls.append(line)
            elif current_section == 'youtube':
                channel_id = get_channel_id_from_url(line)
                if channel_id:
                    urls.append(f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}")
            print(f"Finished reading URLs. Found {len(urls)} URLs.")  
    return urls

def get_youtube_video_id(url):
    """Extracts the YouTube video ID from a URL."""
    match = re.search(r"v=([^&]+)", url)
    return match.group(1) if match else None

def fetch_feeds(urls):
    """Fetches and parses RSS feeds from a list of URLs."""
    print(f"Starting to fetch {len(urls)} feeds...")
    all_items = []
    
    # Set a common user-agent
    user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
    
    for i, url in enumerate(urls):
        print(f"Processing feed {i+1}/{len(urls)}: {url}")
        try:
            feed = feedparser.parse(url, agent=user_agent)
            
            # Check for errors in the feed
            if feed.bozo and isinstance(feed.bozo_exception, Exception):
                print(f"Warning: Could not parse feed from {url}. Error: {feed.bozo_exception}")
                continue

            is_youtube_feed = 'youtube.com' in url

            for entry in feed.entries:
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    published_time = datetime(*entry.published_parsed[:6])
                    if (datetime.now() - published_time).total_seconds() > 5 * 24 * 3600:
                        continue
                elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                    published_time = datetime(*entry.updated_parsed[:6])
                    if (datetime.now() - published_time).total_seconds() > 5 * 24 * 3600:
                        continue
                
                item_id = entry.get('id') or entry.get('link')
                if not item_id:
                    continue

                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    published_time = datetime(*entry.published_parsed[:6])
                elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                    published_time = datetime(*entry.updated_parsed[:6])
                else:
                    published_time = datetime.now()

                thumbnail_url = ''
                video_id = None
                if is_youtube_feed:
                    video_id = get_youtube_video_id(entry.link)
                else:
                    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
                        thumbnail_url = entry.media_thumbnail[0]['url']
                    else:
                        if hasattr(entry, 'content') and entry.content:
                            soup = BeautifulSoup(entry.content[0].value, 'html.parser')
                            img_tag = soup.find('img')
                            if img_tag and img_tag.get('src'):
                                thumbnail_url = img_tag['src']
                        elif hasattr(entry, 'summary'):
                            soup = BeautifulSoup(entry.summary, 'html.parser')
                            img_tag = soup.find('img')
                            if img_tag and img_tag.get('src'):
                                thumbnail_url = img_tag['src']

                summary = ''
                if hasattr(entry, 'summary'):
                    if '<' in entry.summary and '>' in entry.summary:
                        soup = BeautifulSoup(entry.summary, 'html.parser')
                        summary = soup.get_text()
                    else:
                        summary = entry.summary

                all_items.append({
                    'id': item_id,
                    'title': entry.title,
                    'link': entry.link,
                    'published': published_time,
                    'thumbnail': thumbnail_url,
                    'feed_title': feed.feed.title,
                    'summary': summary,
                    'video_id': video_id,
                })
        except Exception as e:
            print(f"Error processing feed {url}: {e}")
            print(f"Finished fetching feeds. Total items: {len(all_items)}") 
    return all_items

def sort_items(items):
    """Sorts items by published date."""
    return sorted(items, key=lambda x: x['published'], reverse=True)
    print("Finished sorting feed items.")

def generate_item_html(item, item_id):
    """Generates HTML for a single feed item."""
    snippet = '<div class="feed-item">\n'
    if item['video_id']:
        snippet += f'<div class="video-container"><iframe src="https://www.youtube.com/embed/{item["video_id"]}" frameborder="0" allowfullscreen></iframe></div>\n'
    elif item['thumbnail']:
        snippet += f'<a href="{item["link"]}" target="_blank"><img src="{item["thumbnail"]}" alt="{item["title"]}" class="feed-thumbnail"></a>\n'
    
    snippet += '<div class="feed-item-info">\n'
    snippet += f'<h2><a href="{item["link"]}" target="_blank">{item["title"]}</a></h2>\n'
    
    # Handle both datetime objects and string timestamps
    published_str = item["published"]
    if isinstance(published_str, datetime):
        published_str = published_str.strftime("%Y-%m-%d %H:%M:%S")
    snippet += f'<p class="published-date">{published_str}</p>\n'

    snippet += f'<p class="feed-title">{item["feed_title"]}</p>\n'
    if item['summary']:
        snippet += f'<button class="toggle-summary-btn" data-target="summary-{item_id}">...</button>\n'
        snippet += f'<div id="summary-{item_id}" class="summary" style="display: none;">{item["summary"]}</div>\n'
    snippet += '</div>\n'
    snippet += '</div>\n'
    return snippet

def process_feed_items(items):
    """
    Groups items by day, generates HTML for the first day, and returns JSON for the rest.
    """
    print("Processing feed items to generate HTML and JSON...")  
    from collections import defaultdict
    import json

    if not items:
        return "", "{}"

    # Group items by day
    grouped_items = defaultdict(list)
    for item in items:
        day = item['published'].strftime('%Y-%m-%d')
        grouped_items[day].append(item)
    
    sorted_days = sorted(grouped_items.keys(), reverse=True)
    
    # --- Generate HTML for the main page ---
    snippet = ""
    
    # 1. Handle the first day (most recent)
    first_day_key = sorted_days[0]
    first_day_items = grouped_items[first_day_key]
    day_str = datetime.strptime(first_day_key, '%Y-%m-%d').strftime('%B %d, %Y')
    
    snippet += '<div class="day-section">\n'
    snippet += f'<h2 class="day-header"><span>{day_str}</span><button class="toggle-day-btn" data-target="day-content-0">-</button></h2>\n'
    snippet += '<div id="day-content-0" class="day-content" style="display: block;">\n'
    for j, item in enumerate(first_day_items):
        snippet += generate_item_html(item, f"0-{j}")
    snippet += '</div>\n</div>\n'

    # 2. Add placeholders for the other days
    for i, day_key in enumerate(sorted_days[1:]):
        day_str = datetime.strptime(day_key, '%Y-%m-%d').strftime('%B %d, %Y')
        day_index = i + 1
        snippet += '<div class="day-section">\n'
        snippet += f'<h2 class="day-header" data-date="{day_key}"><span>{day_str}</span><button class="toggle-day-btn" data-target="day-content-{day_index}">+</button></h2>\n'
        snippet += f'<div id="day-content-{day_index}" class="day-content" style="display: none;"></div>\n'
        snippet += '</div>\n'

    # --- Generate JSON for the other days ---
    other_days_data = {}
    for day_key in sorted_days[1:]:
        # Make items JSON serializable
        serializable_items = []
        for item in grouped_items[day_key]:
            item_copy = item.copy()
            item_copy['published'] = item['published'].strftime("%Y-%m-%d %H:%M:%S")
            serializable_items.append(item_copy)
        other_days_data[day_key] = serializable_items
        
    json_data_string = json.dumps(other_days_data, indent=2)

    print("Finished processing feed items.")
    return snippet, json_data_string

def update_index_html(html_snippet, json_data, template_path='index.template.html', output_path='index.html'):
    """Injects the HTML snippet and last updated time into the index.html template."""
    print(f"Updating {output_path} from template {template_path}...")
    with open(template_path, 'r', encoding='utf-8') as f:
        template = f.read()
    
    # Replace the feed container placeholder
    template = template.replace('<div id="feed-container"></div>', f'<div id="feed-container">{html_snippet}</div>')
    
    # Add the JSON data script before the closing body tag
    json_script_tag = f'<script id="feed-data" type="application/json">{json_data}</script>'
    template = template.replace('</body>', f'{json_script_tag}\n</body>')

    # Update the last updated time
    utc_now = datetime.now(pytz.utc)
    pst_now = utc_now.astimezone(pytz.timezone(TIMEZONE))
    last_updated_time = pst_now.strftime("%Y-%m-%d %H:%M:%S %Z")
    updated_html = template.replace('<!-- last_updated_placeholder -->', last_updated_time)

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(updated_html)
    print(f"Successfully updated {output_path}.")

if __name__ == "__main__":
    urls_file = 'feeds.txt'
    feed_urls = read_urls_from_file(urls_file)
    feed_items = fetch_feeds(feed_urls)
    sorted_items = sort_items(feed_items)
    
    # Process items into HTML for today and JSON for other days
    html_snippet, json_data = process_feed_items(sorted_items)
    
    # Update the main HTML file
    update_index_html(html_snippet, json_data)

    print(f"Successfully fetched and updated index.html with {len(sorted_items)} items.")
