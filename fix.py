import os

filepath = 'script.js'

with open(filepath, 'r', encoding='utf-8') as f:
    c = f.read()

# Fix backticks and dollar sign escaping that leaked from Python patch
c = c.replace('\\`', '`').replace('\\${', '${')

lines = c.split('\n')
for i, l in enumerate(lines):
    if 'const targetYear = state.selectedReportYear;' in l and i > 250:
        lines[i] = '// ' + l

c = '\n'.join(lines)

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(c)
