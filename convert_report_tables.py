from pathlib import Path
import re
import html

src = Path('/Users/zyc/Desktop/跨境猫狗通用宠物免洗擦拭精华清洁套装宠物免水洗除臭留香定制 · eBay美国站选品分析报告.doc')
text = src.read_text(encoding='utf-8-sig')

style = '''<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;color:#202424;margin:42px;line-height:1.75}
h1{font-size:24px;margin:0 0 8px} h2{font-size:17px;margin:28px 0 10px;padding-bottom:7px;border-bottom:1px solid #e5e8e8}
h3{font-size:16px;margin:20px 0 8px} .meta{color:#66706f;font-size:12px}
.docline{font:14px/1.75 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif;white-space:pre-wrap;word-break:break-word;margin:0}
table{border-collapse:collapse;width:100%;margin:12px 0 20px;table-layout:fixed;font:13px/1.55 -apple-system,BlinkMacSystemFont,"Microsoft YaHei",sans-serif}
th,td{border:1px solid #000;padding:8px 9px;vertical-align:middle;word-break:break-word}
th{font-weight:700;background:#f2f2f2;text-align:left}
section{page-break-inside:auto}
</style>'''
text = re.sub(r'<style>.*?</style>', style, text, count=1, flags=re.S)

def cell(v):
    v = v.strip()
    v = v.replace('<br>', '<br/>')
    return v

def render_pre(m):
    raw = html.unescape(m.group(1)).replace('\r\n','\n')
    lines = raw.split('\n')
    out=[]; i=0
    while i < len(lines):
        line=lines[i]
        if line.strip().startswith('|') and i+1 < len(lines) and re.match(r'^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$', lines[i+1]):
            rows=[]
            while i < len(lines) and lines[i].strip().startswith('|'):
                parts=[p.strip() for p in lines[i].strip().strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', p) for p in parts): rows.append(parts)
                i+=1
            if rows:
                cols=max(map(len,rows));
                out.append('<table><thead><tr>'+''.join('<th>'+cell(x)+'</th>' for x in rows[0]+['']*(cols-len(rows[0])))+'</tr></thead><tbody>')
                for row in rows[1:]:
                    row += ['']*(cols-len(row)); out.append('<tr>'+''.join('<td>'+cell(x)+'</td>' for x in row)+'</tr>')
                out.append('</tbody></table>')
            continue
        esc=line
        if re.match(r'^###\s+', esc):
            out.append('<h3>'+html.escape(re.sub(r'^###\s+','',esc))+'</h3>')
        elif re.match(r'^##\s+', esc):
            out.append('<h3>'+html.escape(re.sub(r'^##\s+','',esc))+'</h3>')
        else:
            out.append('<div class="docline">'+esc+'</div>')
        i+=1
    return ''.join(out)

text = re.sub(r'<pre>(.*?)</pre>', render_pre, text, flags=re.S)
src.write_text(text, encoding='utf-8-sig')
print(f'converted: {src}')
print(f'tables: {text.count("<table>")}')
