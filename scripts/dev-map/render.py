import json
import pathlib
import sys
from leveled import Page
from viewer import emit

model = json.load(sys.stdin)
out = pathlib.Path(sys.argv[1])
entries, blobs = [], {}
by_key = {p['key']: p for p in model['pages']}
def ordered(key):
    data = by_key[key]
    yield data
    for node in sorted(data['nodes'], key=lambda n: [int(v) for v in (n.get('num') or '0').split('.')]):
        if node.get('explodes'):
            yield from ordered(node['explodes'])

for data in ordered('0_system'):
    page = Page(data['key'], data['title'], data['subtitle'],
                parent=data.get('parent'), ports_in=data['inputs'],
                ports_out=data['outputs'], width=data.get('width'))
    for item in data['nodes']:
        node = page.n(item['id'], item['label'], kind=item['kind'],
                      num=item.get('num'), note=item.get('note'),
                      anchor=item.get('anchor'), explodes=item.get('explodes'),
                      co=[use['address'] for use in item.get('shared', [])])
        node.anchor_ref = item.get('anchor_ref')
        node.display_foot = item.get('foot')
        node.source_path = item.get('src')
        node.source_line = item.get('line')
    for edge in data['edges']:
        page.e(edge['src'], edge['dst'], edge['label'], edge['kind'], edge['rank'])
    page.layout()
    svg = page.render()
    (out / (page.key + '.svg')).write_text(svg, encoding='utf-8')
    blobs[page.key] = svg
    parent = data.get('parent')
    depth, cursor = 0, data
    while cursor.get('parent'):
        depth += 1
        cursor = by_key[cursor['parent'][0]]
    entries.append(dict(key=page.key, title=page.title, subtitle=page.subtitle,
                        sources=[(src, sum(n.get('src') == src for n in data['nodes']))
                                 for src in sorted({n['src'] for n in data['nodes'] if n.get('src')})],
                        spec=data['source'], parent={'key': parent[0], 'node': parent[1]} if parent else None,
                        kid=bool(parent), depth=depth))

for source in model['specs']:
    used = {n.get('component') for p in model['pages'] if p['source'] == source for n in p['nodes']}
    for contract in model['contracts']:
        if contract['id'] in used:
            model['specs'][source] += '\n\n### Shared: ' + contract['id'] + '\n\n' + '\n'.join([
                'Source: ' + contract['anchor'], 'Inputs: ' + contract['input'],
                'Outputs: ' + contract['output'], contract['semantics']])

path, size = emit(out, [('Core and Studio', entries)], specs=model['specs'],
                  blobs=blobs, code=model['code'])
print(f'{path}: {len(entries)} pages, {size:,} bytes')
