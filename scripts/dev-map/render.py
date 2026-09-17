import json
import pathlib
import sys
from html import escape
from leveled import Page
from viewer import emit, md_to_html
import posixpath
import re

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

if model.get('containment'):
    def responsibility_link(resource):
        responsibility = resource.get('responsibility')
        if not responsibility:
            return '<b>Missing change contract</b>'
        reference, heading = responsibility['contract'].split('#')
        return f'<a href="#reference_{escape(reference, quote=True)}/{escape(heading, quote=True)}">Change contract: {escape(responsibility["id"])}</a>'

    def uses(items):
        return ' · '.join(f'<a href="#{escape(u["page"], quote=True)}" onclick="event.preventDefault();event.stopPropagation();show(\'{escape(u["page"], quote=True)}\')"><b>{escape(u["address"])}</b></a>' for u in items)

    colors = {'direct': '#2f9e73', 'enclosed': '#4b87d1', 'unrepresented': '#d99a38'}
    cards = ['<div id="doc"><h2>Code containment</h2>',
             '<p>Core and Studio: maps own implementation, contracts and supporting resources. Direct means a map box names the declaration; enclosed means only its container is mapped; unrepresented means neither. A maintenance owner does not turn enclosed or unrepresented code into explained behavior.</p>',
             '<div class="card"><h3>Outside implementation scope</h3><p><b>Skills</b> keep separate usage and authoring references. Builders consume map-owned API contracts without reading implementation maps. <b>Client adapters</b> keep their own implementation references. Both contribute caller evidence when core or Studio changes. Roles do not change these component boundaries.</p></div>']
    cards.append('<h3>Map representation required — core and Studio implementation</h3><p>Each file below needs its responsibilities represented in maps and contracts. A helper can be enclosed by a meaningful mapped operation; every declaration does not need its own box. Missing or enclosed declarations remain visible for review. Native implementation appears below as required but not analyzed.</p>')
    cards.append('<p>' + ' &nbsp; '.join(f'<span style="display:inline-block;width:12px;height:12px;border-radius:2px;background:{color}" aria-hidden="true"></span> {status.capitalize()}' for status, color in colors.items()) + ' — each full bar represents all declarations in that module. These bars measure representation, not semantic completeness.</p>')
    analyzed = {f['file'] for f in model['containment']}
    unassessed = [r for r in model.get('resources', []) if r['file'] not in analyzed and r['requirement']['expectation'] == 'required']
    if unassessed:
        cards.append('<h3>Required — representation not assessed by the extractor</h3><p>These implementation files need behavioral documentation even though JavaScript declaration coverage is unavailable. Inspect their owning contracts; lack of extraction is not a coverage pass.</p>')
        for resource in sorted(unassessed, key=lambda r: r['file']):
            owner = resource['owner']
            links = ' · '.join(f'<a href="#reference_{r["id"]}">{escape(r["id"])}</a>' for r in model.get('references', []) if r['owner'] == owner)
            cards.append(f'<p><code>{escape(resource["file"])}</code> — <b>Map representation required</b> · <a href="#{owner}">{owner}</a> — {escape(resource["purpose"])} · {responsibility_link(resource)} · {links}</p>')
    def priority(file):
        return 0 if not file['counts']['direct'] else 1 if file['counts']['unrepresented'] else 2
    current_priority = None
    for file in sorted(model['containment'], key=lambda f: (priority(f), f['file'])):
        rank = priority(file)
        if rank != current_priority:
            title = ['Required — no directly mapped declaration', 'Required — remaining unrepresented declarations', 'Required — declarations directly mapped or enclosed'][rank]
            cards.append(f'<h3>{title}</h3>')
            if rank == 2:
                cards.append('<p>These files follow the gaps above. Enclosure is structural representation, not proof that every behavior is documented.</p>')
            current_priority = rank
        counts = file['counts']
        callables = file['callables']
        cards.append('<div class="card"><details><summary><strong>' + escape(file['file']) + '</strong> — <b>Map representation required</b>' + (' — no directly mapped declaration' if not counts['direct'] else '') + ' — ' +
                     ', '.join(f'{counts[k]} {k}' for k in colors))
        total = sum(counts.values())
        label = ', '.join(f'{k}: {counts[k]} of {total} ({counts[k] / total:.1%})' for k in colors) if total else 'No declarations'
        cards.append(f'<span role="img" aria-label="{escape(label, quote=True)}" style="display:flex;width:100%;height:10px;margin:8px 0 2px;overflow:hidden;border-radius:4px;background:#e4e7eb">')
        for status, color in colors.items():
            if counts[status] and total:
                title = f'{status.capitalize()}: {counts[status]} of {total} ({counts[status] / total:.1%})'
                cards.append(f'<span title="{title}" style="width:{counts[status] / total * 100:.8f}%;background:{color};height:100%"></span>')
        cards.append('</span></summary>')
        cards.append('<p>' + responsibility_link(file) + ' — responsibility, invariants, failures, related changes and verification.</p>')
        owner = file.get('owner')
        if owner:
            cards.append(f'<p>Maintenance owner: <a href="#{owner}" onclick="event.preventDefault();show(\'{owner}\')">{escape(owner)}</a></p>')
        cards.append('<p>Callable declarations: ' + ', '.join(f'{callables[k]} {k}' for k in ['direct', 'enclosed', 'unrepresented']) + '.</p>')
        for status in ['direct', 'enclosed', 'unrepresented']:
            rows = [d for d in file['declarations'] if d['status'] == status]
            if not rows:
                continue
            cards.append(f'<details><summary>{status}: {len(rows)}</summary>')
            for d in rows:
                owner = uses(d['uses'] if status == 'direct' else d['enclosing'])
                cards.append('<p><code>' + escape(d['name']) + '</code> <small>' +
                             escape(f'{d["kind"]}, lines {d["line"]}–{d["endLine"]}') + '</small>' +
                             ((' — ' if status == 'direct' else ' — inside ') + owner if owner else '') + '</p>')
            cards.append('</details>')
        cards.append('</details></div>')
    for expectation, title, explanation in [
        ('reference-only', 'Supporting resources — no implementation box required', 'Assets, build inputs, contracts and compatibility documents require an owning reference. They are not missing function boxes.'),
        ('verification-only', 'Verification evidence — no implementation box required', 'Tests and fixtures support the mapped contracts; their internals are outside production-code coverage.')]:
        resources = [r for r in model.get('resources', []) if r['file'] not in analyzed and r['requirement']['expectation'] == expectation]
        cards.append(f'<details><summary><b>{title}</b> ({len(resources)} files)</summary><p>{explanation}</p>')
        for resource in sorted(resources, key=lambda r: r['file']):
            owner = resource['owner']
            contracts = [r for r in model.get('references', []) if r['owner'] == owner]
            links = ' · '.join(f'<a href="#reference_{r["id"]}">{escape(r["id"])}</a>' for r in contracts)
            cards.append(f'<p><code>{escape(resource["file"])}</code> — <b>{resource["requirement"]["label"]}</b> · <a href="#{owner}">{owner}</a> — {escape(resource["purpose"])}' + (f' · {links}' if links else '') + '</p>')
        cards.append('</details>')
    outside = model.get('externalResources', [])
    cards.append(f'<details><summary><b>Outside dev-map scope — map representation not required</b> ({len(outside)} files)</summary><p>Skills and client adapters keep separate implementation references. These files do not count as missing map coverage; their calls to shared components still appear in impact evidence.</p>')
    for resource in sorted(outside, key=lambda r: r['file']):
        guide = resource.get('guidance')
        link = f' · <a href="../{escape(guide, quote=True)}">separate guidance</a>' if guide else ''
        cards.append(f'<p><code>{escape(resource["file"])}</code> — <b>Map representation not required</b>{link}</p>')
    cards.append('</details>')
    cards.append('</div>')
    entries.insert(1, dict(key='containment', title='Code containment', subtitle='Generated inventory · direct, enclosed and unrepresented',
                           doc=True, sources=[], spec=None, parent=None))
    blobs['containment'] = ''.join(cards)

reference_keys = {r['path']: 'reference_' + r['id'] for r in model.get('references', [])}
region_keys = {p['source']: p['key'] for p in reversed(model['pages'])}

def link_target(path, source):
    if path.startswith('#reference_'):
        return path
    target, _, heading = path.partition('#')
    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), target)) if target else source
    key = reference_keys.get(resolved) or region_keys.get(resolved)
    if key:
        return '#' + key + ('/' + heading if heading else '')
    if re.match(r'^(https?|mailto):', path):
        return path
    return '../' + resolved + ('#' + heading if heading else '')

for reference in model.get('references', []):
    key, owner = reference_keys[reference['path']], reference['owner']
    toc = '<p>' + ' · '.join(f'<a href="#{key}/{h["guidanceId"].split("#")[1]}">{escape(h["title"])}</a>' for h in reference['headings']) + '</p>'
    body = md_to_html(reference['text'], lambda path: link_target(path, reference['path']))
    blobs[key] = '<div id="doc"><p>Map-owned contract · ' + escape(owner) + '</p>' + toc + body + '</div>'
    owner_index = next(i for i, e in enumerate(entries) if e['key'] == owner)
    entries.insert(owner_index + 1, dict(key=key, title=reference['headings'][0]['title'],
                   subtitle=reference['purpose'], doc=True, sources=[], spec=None,
                   parent={'key': owner, 'node': None}, kid=True, depth=entries[owner_index].get('depth', 0)+1))

for source in model['specs']:
    used = {n.get('component') for p in model['pages'] if p['source'] == source for n in p['nodes']}
    for contract in model['contracts']:
        if contract['id'] in used:
            model['specs'][source] += '\n\n### Shared: ' + contract['id'] + '\n\n' + '\n'.join([
                'Source: ' + contract['anchor'], 'Inputs: ' + contract['input'],
                'Outputs: ' + contract['output'], contract['semantics']])
    owned = [r for r in model.get('references', []) if r['source'] == source]
    responsibilities = [r for r in model.get('responsibilities', []) if r['source'] == source]
    if responsibilities:
        model['specs'][source] = '## Implementation change contracts\n\n' + '\n'.join('- [' + r['id'] + '](#reference_' + r['contract'].replace('#', '/') + '): ' + ', '.join('`' + f + '`' for f in r['files']) for r in responsibilities) + '\n\n' + model['specs'][source]
    model['specs'][source] = ('## Contracts and procedures\n\n' + '\n'.join('- [' + r['headings'][0]['title'] + '](#' + reference_keys[r['path']] + '): ' + r['purpose'] for r in owned) + '\n\n' if owned else '') + model['specs'][source]
    model['specs'][source] = re.sub(r'\]\(([^)]+)\)', lambda m: '](' + link_target(m[1], source) + ')', model['specs'][source])

path, size = emit(out, [('Core and Studio', entries)], specs=model['specs'],
                  blobs=blobs, code=model['code'])
print(f'{path}: {len(entries)} pages, {size:,} bytes')
