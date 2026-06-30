import json, itertools
from collections import defaultdict

batches = json.load(open('batches.json'))
invoices = {}
for fn in ('invoices_ocr.json', 'invoices_old.json'):
    invoices.update(json.load(open(fn)))

def monthnum(d):
    return int(d[:4])*12 + int(d[5:7]) if d and len(d) >= 7 else None

VTOL = 0.06  # volume tolerance (MT) to absorb OCR rounding

def vec_from_lines(lines):
    agg = defaultdict(lambda: [0.0, 0.0])
    for (tok, gr, q, v) in lines:
        agg[f'{tok}|{gr}'][0] += q
        agg[f'{tok}|{gr}'][1] += v
    return {k: (round(x[0], 3), round(x[1], 3)) for k, x in agg.items()}

def subset_match(target, pool, field):
    tq = sum(v[0] for v in target.values())
    for r in range(1, min(len(pool), 12) + 1):
        for combo in itertools.combinations(pool, r):
            if abs(sum(batches[b]['total'][0] for b in combo) - tq) > 0.5:
                continue
            agg = defaultdict(lambda: [0.0, 0.0])
            for b in combo:
                for k, v in batches[b].get(field, {}).items():
                    agg[k][0] += v[0]; agg[k][1] += v[1]
            if set(agg.keys()) != set(target.keys()):
                continue
            ok = all(abs(agg[k][0]-q) <= 0.001 and abs(agg[k][1]-v) <= VTOL
                     for k, (q, v) in target.items())
            if ok:
                return list(combo)
    return None

claimed = set()
mapping = {}
orphans = {}
problems = []

# pass 1: code-bearing
for inv, d in invoices.items():
    if d['mode'] == 'code':
        good = [c for c in d['codes'] if c in batches]
        miss = [c for c in d['codes'] if c not in batches]
        mapping[inv] = {'date': d['date'], 'total': d['total'], 'batchNos': good, 'method': 'code'}
        claimed.update(good)
        if miss: problems.append(f"{inv}: codes not found: {miss}")

# pass 2: content (cat / sp), date-windowed unclaimed -> widen
for inv, d in invoices.items():
    if d['mode'] not in ('cat', 'sp'):
        continue
    field = 'subtotals' if d['mode'] == 'cat' else 'subspecies'
    target = vec_from_lines(d['lines'])
    im = monthnum(d['date'])
    pool = []
    for b, bd in batches.items():
        if not bd.get('detailed') or b in claimed: continue
        bm = monthnum(bd.get('date', ''))
        if bm is None or (im is not None and 0 <= (im - bm) <= 5):
            pool.append(b)
    res = subset_match(target, pool, field)
    if res is None:
        pool2 = [b for b, bd in batches.items() if bd.get('detailed') and b not in claimed]
        res = subset_match(target, pool2, field)
    if res:
        mapping[inv] = {'date': d['date'], 'total': d['total'], 'batchNos': sorted(res), 'method': 'content'}
        claimed.update(res)
    else:
        orphans[inv] = {'date': d['date'], 'total': d['total'], 'reason': 'no batch in system'}

# pass 3: explicit archive
for inv, d in invoices.items():
    if d['mode'] == 'archive':
        orphans[inv] = {'date': d['date'], 'total': d['total'], 'reason': 'pre-system / orphan'}

print('===== LINKED INVOICES =====')
for inv in sorted(mapping):
    m = mapping[inv]
    print(f"{inv}  {m['date']}  RM{m['total']:>12,.2f}  [{m['method']:7}] -> {', '.join(m['batchNos'])}")

print('\n===== ORPHAN / ARCHIVE INVOICES (no batch in system) =====')
for inv in sorted(orphans):
    o = orphans[inv]
    print(f"{inv}  {o['date']}  RM{o['total']:>12,.2f}  ({o['reason']})")

print('\n===== PROBLEMS =====')
print('\n'.join(' - '+p for p in problems) if problems else ' none')

all_b = set(batches.keys())
unl = sorted(all_b - claimed)
print(f"\nBatches: {len(all_b)} | linked: {len(claimed)} | unlinked: {len(unl)}")
print('Unlinked batches:', ', '.join(unl) if unl else '(none)')
print(f"Invoices: {len(invoices)} | linked: {len(mapping)} | orphan-archive: {len(orphans)}")

json.dump({'linked': mapping, 'orphans': orphans}, open('invoice_batch_map.json', 'w'), indent=1)
print('\nwrote invoice_batch_map.json')
