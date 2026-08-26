"""
网页抓取 MCP Server
用于 RAGFlow「选品分析师」智能体：读取用户提供的商品链接（如 1688 商品页），
提取品类、价格、材质、规格、功能等结构化信息，供智能体结合知识库分析。

部署：/opt/yandu/mcp-fetch/server.py
运行：nohup python3 server.py > server.log 2>&1 &
监听：8095 端口（Streamable HTTP）
"""
import json
import re
import html
import urllib.parse
from typing import Any

import requests
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("yandu-web-fetch", host="0.0.0.0", port=8095)

HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
TIMEOUT = 20


def _clean_text(text: str) -> str:
    """压缩空白并截断过长的内容"""
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()[:12000]


def _fetch_html(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or "utf-8"
    text = resp.text

    # 1688 桌面详情页常对服务器返回仅含脚本的空壳 HTML。检测到商品 ID 且
    # 页面没有商品数据时，改读同一商品的移动页；移动页包含可解析的标题、
    # 属性和图片数据，并且无需把失败结果误报为有效抓取。
    parsed = urllib.parse.urlparse(url)
    offer_match = re.search(r"/offer/(\d+)\.html", parsed.path)
    if offer_match and parsed.hostname and parsed.hostname.endswith("1688.com"):
        if len(text) < 10000 or "offerImgList" not in text:
            mobile_url = f"https://m.1688.com/offer/{offer_match.group(1)}.html"
            mobile_headers = {
                **HEADERS,
                "User-Agent": (
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
                    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
                    "Mobile/15E148 Safari/604.1"
                ),
            }
            mobile = requests.get(mobile_url, headers=mobile_headers, timeout=TIMEOUT)
            mobile.raise_for_status()
            mobile.encoding = mobile.apparent_encoding or "utf-8"
            if len(mobile.text) > len(text):
                text = mobile.text
    return text


def _parse_1688(html_text: str) -> dict[str, Any]:
    """解析 1688 商品详情页，提取结构化字段"""
    soup = BeautifulSoup(html_text, "html.parser")
    result: dict[str, Any] = {"platform": "1688"}

    # 标题
    title = soup.find("h1")
    if title:
        result["title"] = _clean_text(title.get_text(" ", strip=True))
    elif soup.title:
        result["title"] = _clean_text(soup.title.string or "")

    # 价格：常见于 .price-text / [class*=price] 等
    price_el = soup.select_one(
        ".price-text, .price, [class*=price-text], [class*=Price]"
    )
    if price_el:
        raw = price_el.get_text(" ", strip=True)
        result["price"] = _clean_text(raw)

    # 属性表：1688 详情页通常有 dt/dd 或 th/td 的规格表
    attrs: list[tuple[str, str]] = []
    for dt, dd in zip(soup.select("dt"), soup.select("dd")):
        k = dt.get_text(" ", strip=True)
        v = dd.get_text(" ", strip=True)
        if k and v:
            attrs.append((k, v))
    if attrs:
        result["attributes"] = attrs[:40]

    # 页面正文
    body = soup.get_text(" ", strip=True)
    result["page_text"] = _clean_text(body)

    # 图片
    imgs = []
    for img in soup.select("img[src]")[:20]:
        src = img.get("src") or img.get("data-lazyload") or ""
        if src.startswith("//"):
            src = "https:" + src
        if src and src.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            imgs.append(src)
    if imgs:
        result["images"] = imgs[:10]

    return result


@mcp.tool()
def fetch_webpage(url: str) -> str:
    """抓取网页内容并转为可读文本。适用于 1688、亚马逊等商品页面，返回页面标题、价格、属性表及正文摘要。"""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        text = _fetch_html(url)
    except Exception as exc:
        return f"抓取失败：{exc}"

    soup = BeautifulSoup(text, "html.parser")
    title = ""
    if soup.title:
        title = _clean_text(soup.title.string or "")
    body = _clean_text(soup.get_text(" ", strip=True))
    return f"标题：{title}\n\n正文：\n{body}"


@mcp.tool()
def fetch_1688_product(url: str) -> str:
    """抓取 1688 商品详情页并提取结构化信息：标题、价格、规格属性、图片、正文摘要。"""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        text = _fetch_html(url)
    except Exception as exc:
        return f"抓取失败：{exc}"

    data = _parse_1688(text)
    parts = [f"平台：{data.get('platform')}"]
    if data.get("title"):
        parts.append(f"标题：{data['title']}")
    if data.get("price"):
        parts.append(f"价格：{data['price']}")
    if data.get("attributes"):
        attrs = "\n".join(f"  - {k}: {v}" for k, v in data["attributes"])
        parts.append(f"规格属性：\n{attrs}")
    if data.get("images"):
        parts.append(f"图片（{len(data['images'])}张）：")
        parts.extend(f"  {im}" for im in data["images"])
    parts.append(f"页面正文摘要：\n{data.get('page_text', '')}")
    return "\n".join(parts)


@mcp.tool()
def search_web(query: str, max_results: int = 5) -> str:
    """联网搜索（备用工具）：返回搜索建议，实际搜索能力依赖知识库与模型。"""
    return (
        f"搜索词：{query}\n"
        "说明：当前服务器未配置外部搜索引擎 API。请基于知识库内容分析，"
        "如需实时数据请使用 fetch_webpage 抓取具体商品页面。"
    )


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
