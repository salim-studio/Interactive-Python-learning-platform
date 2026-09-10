import sys
sys.path.insert(0, 'backend')
from kernel_manager import get_kernel, gpu_info
k = get_kernel(None)
r1 = k.execute('x = 100')
r2 = k.execute('print(x)')
print('TEST1 err:', r1['error'])
print('TEST1 out:', r2['outputs'])
assert r2['outputs'] and '100' in r2['outputs'][0]['text'], 'kernel state FAILED'
r3 = k.execute('import pandas as pd\ndf=pd.DataFrame({"a":[1,2,3]})\ndf')
print('TEST2 types:', [o['type'] for o in r3['outputs']])
assert any(o['type']=='dataframe' for o in r3['outputs']), 'dataframe FAILED'
r4 = k.execute('import matplotlib.pyplot as plt\nplt.plot([1,2,3],[1,4,9])\nprint("plotted")')
print('TEST3 types:', [o['type'] for o in r4['outputs']])
assert any(o['type']=='image' for o in r4['outputs']), 'plot FAILED'
r5 = k.execute('print(undefined_var)')
print('TEST4 err:', r5['error']['type'], '|', r5['error']['hint'][:70])
assert r5['error']['type']=='NameError'
r6 = k.execute('import sympy as sp\nx=sp.symbols("x")\nsp.solve(x**2-4, x)')
print('TEST5 sympy:', [o['type'] for o in r6['outputs']])
print('VARS:', [(v['name'], v['type']) for v in k.get_variables()][:6])
print('GPU:', gpu_info())
print('ALL KERNEL TESTS PASSED')
