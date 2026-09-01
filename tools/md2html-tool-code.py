"""
Markdown → HTML 深度研究报告生成工具（MaxKB 自定义工具）
上传至 OSS，返回结构化 dict。

对齐 file_upload_tool 的通用模式：_plain / _cfg / _result / _extract_file_id。
"""
import os
import re
import io
import html
import requests
from datetime import datetime

# -- fallback-creds-v2 --
FALLBACK_UPLOAD_URL = "__FALLBACK_UPLOAD_URL__"
FALLBACK_UPLOAD_HEADERS = "__FALLBACK_UPLOAD_HEADERS__"


CSS = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif;
    line-height: 1.8; color: #1e293b; background: #f8fafc;
    padding: 40px 20px; -webkit-font-smoothing: antialiased;
}
.container {
    max-width: 900px; margin: 0 auto; background: #fff;
    padding: 50px 60px; border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.06);
}
h1 {
    font-size: 28px; font-weight: 700; color: #0f172a;
    border-bottom: 3px solid #2563eb; padding-bottom: 16px;
    margin-bottom: 32px; line-height: 1.3;
}
h2 {
    font-size: 20px; font-weight: 600; color: #1e293b;
    margin-top: 40px; margin-bottom: 16px;
    padding-left: 14px; border-left: 4px solid #2563eb;
}
h3 { font-size: 17px; font-weight: 600; color: #334155; margin-top: 28px; margin-bottom: 12px; }
p { margin-bottom: 14px; color: #334155; }
strong { color: #0f172a; font-weight: 600; }
ul, ol { padding-left: 24px; margin-bottom: 14px; }
li { margin-bottom: 6px; color: #475569; }
blockquote {
    border-left: 4px solid #94a3b8; padding: 12px 20px;
    margin: 16px 0; background: #f1f5f9; border-radius: 0 8px 8px 0;
    color: #64748b; font-style: italic;
}
pre {
    background: #1e293b; color: #e2e8f0; padding: 20px 24px;
    border-radius: 8px; overflow-x: auto; margin: 16px 0;
    font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.6;
}
code {
    font-family: 'Consolas', 'Monaco', monospace; font-size: 13px;
    background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #be185d;
}
pre code { background: none; padding: 0; color: inherit; }
table {
    width: 100%; border-collapse: collapse; margin: 20px 0;
    font-size: 14px; border-radius: 8px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
th {
    background: #1e40af; color: #fff; font-weight: 600;
    padding: 12px 16px; text-align: left; font-size: 13px;
    text-transform: uppercase; letter-spacing: 0.5px;
}
td { padding: 11px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; }
tr:nth-child(even) td { background: #f8fafc; }
tr:hover td { background: #eff6ff; }
hr { border: none; border-top: 1px solid #e2e8f0; margin: 32px 0; }
a { color: #2563eb; text-decoration: none; }
a:hover { text-decoration: underline; }
.footer {
    margin-top: 48px; padding-top: 20px; border-top: 1px solid #e2e8f0;
    text-align: center; font-size: 12px; color: #94a3b8;
}
"""

# ── 辅助函数（对齐 file_upload_tool） ──


def _plain(value) -> str:
    """健壮取值：兼容 str / dict / 对象 / None"""
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in ["value", "content", "text", "result", "data"]:
            if key in value:
                return _plain(value[key])
        return str(value).strip()
    for attr in ["value", "content", "text", "result", "data"]:
        if hasattr(value, attr):
            try:
                return _plain(getattr(value, attr))
            except Exception:
                pass
    return str(value).strip()


def _cfg(name: str, value: str = "", default: str = "") -> str:
    """环境变量兜底：传入值 > 环境变量 > 默认值"""
    value = _plain(value)
    return value or _plain(os.getenv(name)) or _plain(os.getenv(name.upper())) or default


def _result(status: str, message: str, file_name: str = "",
            download_url: str = "", file_id: str = "", extra=None) -> dict:
    """统一构造返回 dict"""
    result = {
        "status": status,
        "message": _plain(message),
        "file_id": file_id,
        "file_name": _plain(file_name),
        "download_url": download_url,
    }
    if extra is not None:
        result["extra"] = extra
    return result


def _extract_file_id(resp_json) -> str:
    """从响应中提取 file_id，兼容多种返回格式"""
    def pick(text) -> str:
        text = _plain(text)
        if not text:
            return ""
        match = re.search(r"oss/file/([^/]+)", text)
        if match:
            return match.group(1)
        if "/" not in text and "." not in text:
            return text
        return ""

    if not isinstance(resp_json, dict):
        return ""

    for key in ["file_id", "id", "oss_id", "uuid"]:
        if resp_json.get(key):
            return _plain(resp_json[key])

    for key in ["url", "path", "download_url", "file_url"]:
        fid = pick(resp_json.get(key))
        if fid:
            return fid

    data = resp_json.get("data")
    if isinstance(data, str):
        return pick(data)
    if isinstance(data, dict):
        for key in ["file_id", "id", "oss_id", "uuid"]:
            if data.get(key):
                return _plain(data[key])
        for key in ["url", "path", "download_url", "file_url"]:
            fid = pick(data.get(key))
            if fid:
                return fid

    return ""


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<div class="container">
{body}
<div class="footer">由深度研究智能体生成 | {date}</div>
</div>
</body>
</html>"""


def escape(text):
    return html.escape(text)


def process_inline(text):
    """处理行内 Markdown：粗体、斜体、行内代码、链接"""
    # 行内代码（先处理，避免被其他规则干扰）
    text = re.sub(r'`([^`]+)`', r'<code>\1</code>', text)
    # 粗体
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    # 斜体
    text = re.sub(r'\*(.+?)\*', r'<em>\1</em>', text)
    # 链接 [text](url)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2" target="_blank">\1</a>', text)
    # 图片占位
    text = re.sub(r'!\[([^\]]*)\]\([^)]+\)', r'<span style="color:#94a3b8;font-style:italic">[图片: \1]</span>', text)
    return text


def markdown_to_html_body(md_text):
    """将 Markdown 转换为 HTML body 内容"""
    lines = md_text.split('\n')
    parts = []
    i = 0

    while i < len(lines):
        line = lines[i].rstrip()

        # 空行
        if not line.strip():
            i += 1
            continue

        # 分割线
        if re.match(r'^[\s]*[-*_]{3,}\s*$', line):
            parts.append('<hr>')
            i += 1
            continue

        # 标题
        m = re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            level = min(len(m.group(1)), 4)
            text = process_inline(escape(m.group(2).strip()))
            parts.append(f'<h{level}>{text}</h{level}>')
            i += 1
            continue

        # 代码块
        if line.strip().startswith('```'):
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith('```'):
                code_lines.append(escape(lines[i]))
                i += 1
            i += 1
            code_text = '\n'.join(code_lines)
            parts.append(f'<pre><code>{code_text}</code></pre>')
            continue

        # 引用块
        if line.strip().startswith('>'):
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith('>'):
                quote_lines.append(process_inline(escape(lines[i].strip().lstrip('>').strip())))
                i += 1
            parts.append(f'<blockquote>{"<br>".join(quote_lines)}</blockquote>')
            continue

        # 表格
        if '|' in line and re.match(r'^\s*\|.*\|\s*$', line):
            table_lines = []
            while i < len(lines) and '|' in lines[i] and re.match(r'^\s*\|.*\|\s*$', lines[i]):
                table_lines.append(lines[i])
                i += 1
            if len(table_lines) >= 2:
                def parse_row(row_str):
                    return [c.strip() for c in row_str.strip().strip('|').split('|')]
                headers = parse_row(table_lines[0])
                data_start = 2 if re.match(r'^\s*\|[\s\-:|]+\|\s*$', table_lines[1]) else 1
                rows = [parse_row(r) for r in table_lines[data_start:]]
                cols = len(headers)
                html_table = '<table><thead><tr>'
                for h in headers:
                    html_table += f'<th>{process_inline(escape(h))}</th>'
                html_table += '</tr></thead><tbody>'
                for row in rows:
                    html_table += '<tr>'
                    for ci in range(min(len(row), cols)):
                        html_table += f'<td>{process_inline(escape(row[ci]))}</td>'
                    html_table += '</tr>'
                html_table += '</tbody></table>'
                parts.append(html_table)
            continue

        # 无序列表
        if re.match(r'^[\s]*[-*+]\s+', line):
            list_items = []
            while i < len(lines):
                if re.match(r'^[\s]*[-*+]\s+', lines[i]):
                    text = re.sub(r'^[\s]*[-*+]\s+', '', lines[i])
                    list_items.append(f'<li>{process_inline(escape(text))}</li>')
                    i += 1
                elif not lines[i].strip():
                    # 跳过空行，继续检查后面是否还有列表项
                    j = i + 1
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and re.match(r'^[\s]*[-*+]\s+', lines[j]):
                        i = j
                    else:
                        break
                else:
                    break
            parts.append(f'<ul>{"".join(list_items)}</ul>')
            continue

        # 有序列表
        if re.match(r'^[\s]*\d+[.)]\s+', line):
            list_items = []
            while i < len(lines):
                if re.match(r'^[\s]*\d+[.)]\s+', lines[i]):
                    text = re.sub(r'^[\s]*\d+[.)]\s+', '', lines[i])
                    list_items.append(f'<li>{process_inline(escape(text))}</li>')
                    i += 1
                elif not lines[i].strip():
                    j = i + 1
                    while j < len(lines) and not lines[j].strip():
                        j += 1
                    if j < len(lines) and re.match(r'^[\s]*\d+[.)]\s+', lines[j]):
                        i = j
                    else:
                        break
                else:
                    break
            parts.append(f'<ol>{"".join(list_items)}</ol>')
            continue

        # 普通段落
        para_lines = []
        while i < len(lines) and lines[i].strip() and not re.match(r'^(#{1,6}\s|```|>|\||[-*+]\s|\d+[.)]\s|[-*_]{3,}\s*$)', lines[i]):
            para_lines.append(lines[i])
            i += 1
        if para_lines:
            text = process_inline(escape(' '.join(para_lines)))
            parts.append(f'<p>{text}</p>')
            continue

        i += 1

    return '\n'.join(parts)


def _first_title(md_text: str):
    """提取主标题：跳过 '# 第X部分' 形式的小节标题，无匹配返回 None"""
    return re.search(r'^#\s+(?!第.+部分)(.+)', md_text, re.MULTILINE)


def main(md_text: str, filename: str = "", upload_url: str = "",
         upload_headers: str = ""):
    """
    MaxKB 工具入口函数
    :param md_text:       Markdown 正文（直接传入 {{DeepResearch.answer}}）
    :param filename:      文件名（不含扩展名），留空则自动从正文第一个 # 标题提取
    :param upload_url:    MaxKB 服务器地址，如 http://x.x.x.x:8080
    :param upload_headers: API Bearer Token
    :return: dict { status, message, file_id, file_name, download_url }
    """
    # ── 参数规整化 ──
    md_text = _plain(md_text)
    filename = _plain(filename)
    upload_url = _cfg("upload_url", upload_url)
    upload_headers = _cfg("upload_headers", upload_headers)
    # -- sanitize-creds-v2 --：公共频道曾传入掩码脏值（xxxxxxxxxxxxxx:8882）导致 DNS 失败
    if (not upload_url) or ("xxxx" in upload_url) or (":8882" in upload_url):
        upload_url = FALLBACK_UPLOAD_URL
    if (not upload_headers) or ("xxxx" in upload_headers) or len(upload_headers) < 20:
        upload_headers = FALLBACK_UPLOAD_HEADERS

    # ── 校验 ──
    if not md_text:
        return _result("failed", "md_text 为空，无法生成文档")

    if not upload_url:
        return _result("failed", "缺少 upload_url，请配置 MaxKB 服务地址")

    if not upload_headers:
        return _result("failed", "缺少 upload_headers，请配置 API Token")

    try:
        # 1. 自动提取文件名（跳过“# 第X部分”小节标题；-- title-guard-v2 --）
        if not filename:
            title_match = _first_title(md_text)
            filename = title_match.group(1).strip() if title_match else "跨境AI选品调研报告"
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', filename).strip() or "跨境AI选品调研报告"

        # 2. 提取标题用于 HTML <title>
        title_match = _first_title(md_text)
        page_title = title_match.group(1).strip() if title_match else safe_name

        # 3. Markdown → HTML
        body_html = markdown_to_html_body(md_text)
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        full_html = HTML_TEMPLATE.format(
            title=escape(page_title),
            css=CSS,
            body=body_html,
            date=now,
        )
        data_bytes = full_html.encode('utf-8')

        # 4. 上传到 OSS（对齐通用工具 /chat/api/oss/file）
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        upload_name = f"{safe_name}_{timestamp}.html"
        api_url = upload_url.rstrip('/') + "/chat/api/oss/file"

        headers = {"Authorization": f"Bearer {upload_headers}"}
        buf = io.BytesIO(data_bytes)
        form_data = {"source_type": "TEMPORARY_30_MINUTE", "source_id": "TEMPORARY_30_MINUTE"}
        files = {"file": (upload_name, buf, "text/html; charset=utf-8")}

        try:
            resp = requests.post(api_url, headers=headers, data=form_data, files=files, timeout=120)
        except Exception as e:
            return _result("failed", f"上传请求异常：{e}", f"{safe_name}.html",
                           extra={"upload_url": api_url})

        if resp.status_code < 200 or resp.status_code >= 300:
            return _result("failed", "上传失败", f"{safe_name}.html",
                           extra={"status_code": resp.status_code,
                                  "response": resp.text[:500]})

        try:
            resp_json = resp.json()
        except Exception:
            return _result("failed", "服务端返回非 JSON", f"{safe_name}.html",
                           extra={"response": resp.text[:500]})

        file_id = _extract_file_id(resp_json)
        if not file_id:
            return _result("warning", "上传成功但未解析到 file_id", f"{safe_name}.html",
                           extra={"response": resp_json})

        download_url = f"{upload_url.rstrip('/')}/chat/oss/file/{file_id}/"

        # -- word-upload-v2 --：同内容以 Word 兼容格式（.doc）二次上传，供对话框内直接下载 Word 版
        word_url = ""
        try:
            word_name = f"{safe_name}_{timestamp}.doc"
            wbuf = io.BytesIO(data_bytes)
            wfiles = {"file": (word_name, wbuf, "application/msword")}
            wresp = requests.post(api_url, headers=headers, data=form_data, files=wfiles, timeout=120)
            if 200 <= wresp.status_code < 300:
                wfid = _extract_file_id(wresp.json())
                if wfid:
                    word_url = f"{upload_url.rstrip('/')}/chat/oss/file/{wfid}/"
        except Exception:
            word_url = ""

        res = _result("success", f"报告已生成：{page_title}",
                      f"{safe_name}.html", download_url, file_id,
                      extra={"page_title": page_title, "word_url": word_url})
        res["word_url"] = word_url
        return res

    except Exception as e:
        return _result("failed", f"异常：{type(e).__name__}: {str(e)}")
