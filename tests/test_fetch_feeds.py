import unittest
from datetime import datetime
from unittest.mock import patch

import feedparser
import pytz

from scripts.fetch_feeds import FeedProcessor


class YouTubeShortsTests(unittest.TestCase):
    def setUp(self):
        self.processor = FeedProcessor()
        self.addCleanup(self.processor.session.close)
        self.processor.utc_now = datetime(2026, 9, 8, tzinfo=pytz.utc)

    def process_entry(self, link, include_shorts, youtube=True):
        feed = feedparser.parse(f'''<?xml version="1.0"?>
            <feed xmlns="http://www.w3.org/2005/Atom"
                  xmlns:yt="http://www.youtube.com/xml/schemas/2015">
              <title>Black Hat</title>
              <entry>
                <id>yt:video:MP757qc0rbw</id>
                <yt:videoId>MP757qc0rbw</yt:videoId>
                <title>Black Hat Stories | Founder and Creator of Black Hat</title>
                <link rel="alternate" href="{link}"/>
                <published>2026-09-07T17:00:17+00:00</published>
              </entry>
            </feed>''')
        url = ('https://www.youtube.com/feeds/videos.xml?playlist_id=UULFtest'
               if youtube else 'https://example.com/feed')
        with patch('scripts.fetch_feeds.INCLUDE_YOUTUBE_SHORTS', include_shorts):
            return self.processor._process_feed_entries(feed, url)

    def test_shorts_excluded(self):
        for suffix in ('', '?feature=share'):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.process_entry(
                    'https://www.youtube.com/shorts/MP757qc0rbw' + suffix, False), [])

    def test_shorts_included_when_enabled(self):
        items = self.process_entry('https://www.youtube.com/shorts/MP757qc0rbw', True)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['video_id'], 'MP757qc0rbw')

    def test_regular_video_with_stories_in_title_kept(self):
        items = self.process_entry('https://www.youtube.com/watch?v=MP757qc0rbw', False)
        self.assertEqual(len(items), 1)

    def test_non_youtube_feed_unchanged(self):
        items = self.process_entry('https://example.com/shorts/article', False, youtube=False)
        self.assertEqual(len(items), 1)


if __name__ == '__main__':
    unittest.main()
