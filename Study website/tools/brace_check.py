import sys
p = r'c:\Users\Enzo\Documents\Study website\app.js'
with open(p, 'r', encoding='utf8') as f:
    s = f.read()

stack = []
line = 1
col = 0
in_sq = in_dq = in_bt = False
in_line = in_block = False
in_template_expr = 0
esc = False
for i, ch in enumerate(s):
    if ch == '\n':
        line += 1
        col = 0
        in_line = False
        esc = False
        continue
    col += 1

    if in_line:
        continue
    if in_block:
        if ch == '*' and s[i + 1:i + 2] == '/':
            in_block = False
        continue

    if not (in_sq or in_dq or in_bt):
        if ch == '/' and s[i + 1:i + 2] == '/':
            in_line = True
            continue
        if ch == '/' and s[i + 1:i + 2] == '*':
            in_block = True
            continue

    if ch == '\\' and not esc:
        esc = True
        continue

    if in_sq:
        if ch == "'" and not esc:
            in_sq = False
        esc = False
        continue
    if in_dq:
        if ch == '"' and not esc:
            in_dq = False
        esc = False
        continue

    if in_bt:
        if ch == '`' and not esc and in_template_expr == 0:
            in_bt = False
        elif ch == '$' and s[i + 1:i + 2] == '{':
            in_template_expr += 1
            stack.append((line, col, '${'))
        elif ch == '}' and in_template_expr > 0:
            # pop last '${'
            for j in range(len(stack) - 1, -1, -1):
                if stack[j][2] == '${':
                    stack.pop(j)
                    in_template_expr -= 1
                    break
        esc = False
        continue

    if ch == "'":
        in_sq = True
        esc = False
        continue
    if ch == '"':
        in_dq = True
        esc = False
        continue
    if ch == '`':
        in_bt = True
        esc = False
        continue

    if ch == '{':
        stack.append((line, col, '{'))
    elif ch == '}':
        if stack:
            stack.pop()
        else:
            print('UNEXPECTED_CLOSING at', line, col)
            sys.exit(0)

if stack:
    print('UNMATCHED_OPEN_COUNT', len(stack))
    for ln, co, ch in stack[-8:]:
        print('  AT', ln, co, ch)
    ln, co, ch = stack[-1]
    lines = s.splitlines()
    start = max(0, ln - 4)
    end = min(len(lines), ln + 3)
    print('\nContext around last unmatched open:')
    for L in range(start, end):
        prefix = '>' if (L + 1 == ln) else ' '
        print(f"{prefix} {L+1:4}: {lines[L]}")
else:
    print('ALL_MATCHED')
