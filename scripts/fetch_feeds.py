import feedparser
import json
from datetime import datetime, timedelta
from bs4 import BeautifulSoup
import os
import re
import requests
import pytz

# Configuration
HISTORY_LIMIT = 500
TIMEZONE = 'America/Los_Angeles'

def get_channel_id_from_url(url):
    """Extracts the channel ID from a YouTube channel URL."""
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
    return urls

def load_history(file_path):
    """Loads the history of seen items from a JSON file."""
    if not os.path.exists(file_path):
        return []
    with open(file_path, 'r') as f:
        return json.load(f)

def save_history(history, file_path):
    """Saves the history of seen items to a JSON file, trimming it to a limit."""
    trimmed_history = history[-HISTORY_LIMIT:]
    with open(file_path, 'w') as f:
        json.dump(trimmed_history, f, indent=4)

def get_youtube_video_id(url):
    """Extracts the YouTube video ID from a URL."""
    match = re.search(r"v=([^&]+)", url)
    return match.group(1) if match else None

def fetch_feeds(urls, history):
    """Fetches and parses RSS feeds from a list of URLs."""
    all_items = []
    new_history = set(history)
    
    for i, url in enumerate(urls):
        print(f"Processing feed {i+1}/{len(urls)}: {url}")
        feed = feedparser.parse(url)
        is_youtube_feed = 'youtube.com' in url

        for entry in feed.entries:
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                published_time = datetime(*entry.published_parsed[:6])
                if (datetime.now() - published_time).total_seconds() > 24 * 3600:
                    continue
            elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                published_time = datetime(*entry.updated_parsed[:6])
                if (datetime.now() - published_time).total_seconds() > 24 * 3600:
                    continue
            
            item_id = entry.get('id') or entry.get('link')
            if not item_id:
                continue

            is_new = item_id not in history
            new_history.add(item_id)

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
                'is_new': is_new,
                'feed_title': feed.feed.title,
                'summary': summary,
                'video_id': video_id,
            })
            
    return all_items, list(new_history)

def sort_items(items):
    """Sorts items by new status and then by published date."""
    return sorted(items, key=lambda x: (not x['is_new'], x['published']), reverse=True)

def generate_html_snippet(items):
    """Generates an HTML snippet from a list of feed items."""
    snippet = ""
    for i, item in enumerate(items):
        snippet += '<div class="feed-item">\n'
        if item['video_id']:
            snippet += f'<div class="video-container"><iframe src="https://www.youtube.com/embed/{item["video_id"]}" frameborder="0" allowfullscreen></iframe></div>\n'
        elif item['thumbnail']:
            snippet += f'<a href="{item["link"]}" target="_blank"><img src="{item["thumbnail"]}" alt="{item["title"]}" class="feed-thumbnail"></a>\n'
        
        snippet += '<div class="feed-item-info">\n'
        snippet += f'<h2><a href="{item["link"]}" target="_blank">{item["title"]}</a></h2>\n'
        snippet += f'<p class="published-date">{item["published"].strftime("%Y-%m-%d %H:%M:%S")}</p>\n'
        snippet += f'<p class="feed-title">{item["feed_title"]}</p>\n'
        if item['summary']:
            snippet += f'<button class="toggle-summary-btn" data-target="summary-{i}">...</button>\n'
            snippet += f'<div id="summary-{i}" class="summary" style="display: none;">{item["summary"]}</div>\n'
        snippet += '</div>\n'
        snippet += '</div>\n'
    return snippet

def update_index_html(html_snippet, template_path='index.template.html', output_path='index.html'):
    """Injects the HTML snippet and last updated time into the index.html template."""
    with open(template_path, 'r') as f:
        template = f.read()
    
    template = template.replace('<div id="feed-container"></div>', f'<div id="feed-container">{html_snippet}</div>')
    
    utc_now = datetime.now(pytz.utc)
    pst_now = utc_now.astimezone(pytz.timezone(TIMEZONE))
    last_updated_time = pst_now.strftime("%Y-%m-%d %H:%M:%S %Z")
    updated_html = template.replace('<!-- last_updated_placeholder -->', last_updated_time)

    with open(output_path, 'w') as f:
        f.write(updated_html)

if __name__ == "__main__":
    urls_file = 'feeds.txt'
    history_file = 'history.json'
    
    history = load_history(history_file)
    feed_urls = read_urls_from_file(urls_file)
    feed_items, new_history = fetch_feeds(feed_urls, history)
    sorted_items = sort_items(feed_items)
    html_snippet = generate_html_snippet(sorted_items)
    update_index_html(html_snippet)
    save_history(new_history, history_file)
    
    print(f"Successfully fetched and updated index.html with {len(sorted_items)} items.")
