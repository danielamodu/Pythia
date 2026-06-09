import sys
from bs4 import BeautifulSoup
import urllib.request
import re

url = "https://docs.somnia.network/agents/invoking-agents/from-solidity"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
try:
    html = urllib.request.urlopen(req).read()
    soup = BeautifulSoup(html, 'html.parser')
    for code in soup.find_all('code'):
        print("--- CODE BLOCK ---")
        print(code.get_text())
except Exception as e:
    print("Error:", e)
