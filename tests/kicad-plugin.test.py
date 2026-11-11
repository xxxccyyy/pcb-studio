# KiCad 插件 mock 测试（roadmap #2a）：fake pcbnew/wx 注入 + 真实 node CLI 子进程，
# 覆盖 _repo_root 三条解析路径、Run() 命令序列、四条错误路径、route 输出容错。
# pcbnew 真机调用链（ExportSpecctraDSN/ImportSpecctraSES 的 KiCad 侧行为）需要
# 装有 KiCad 的机器实测——见 kicad-plugin/README.md 的 headless 指引。
import io, importlib.util, json, os, shutil, sys, tempfile, unittest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN_SRC = os.path.join(REPO, 'kicad-plugin', 'pcb-studio-router.py')

# 设计一个真实可导入的小 DSN（自工具方言：µm 刻度；一张两焊盘板）
DSN_FIXTURE = '''(pcb "mock.dsn"
  (parser (string_quote "") (space_in_quoted_tokens on) (host_cad "PCB自动布线工具"))
  (resolution um 10)
  (unit um)
  (structure
    (layer Top (type signal)) (layer Bottom (type signal))
    (boundary (path pcb 0  0 0  30000 0  30000 20000  0 20000  0 0))
    (via VIA_DEFAULT)
    (rule (width 300) (clearance 200))
  )
  (placement
    (component R0402 (place "R1" 0 0 front 0))
  )
  (library
    (image R0402
      (pin PAD1 "1" 5000 10000)
      (pin PAD1 "2" 25000 10000))
    (padstack PAD1 (shape (rect signal -600 -300 600 300)) (attach off))
    (padstack VIA_DEFAULT (shape (circle signal 800)) (attach off))
  )
  (network
    (net "SIG" (pins "R1-1" "R1-2"))
  )
)'''

class FakePcbnew:
    """pcbnew 替身：可编程返回值 + 调用记录。"""
    def __init__(self, dsn_ok=True, ses_ok=True, dsn_text=DSN_FIXTURE):
        self.ActionPlugin = type('ActionPlugin', (), {
            'register': lambda self: FAKE_REG.append(self),
            'defaults': lambda self: None,
            'Run': lambda self: None,
        })
        self.GetBoard = lambda: 'FAKE_BOARD'
        self._dsn_ok, self._ses_ok, self._dsn_text = dsn_ok, ses_ok, dsn_text
        self.calls = {'dsn_paths': [], 'ses_paths': []}

    def ExportSpecctraDSN(self, path):
        self.calls['dsn_paths'].append(path)
        if not self._dsn_ok:
            return False
        io.open(path, 'w', encoding='utf8').write(self._dsn_text)
        return True

    def ImportSpecctraSES(self, path):
        self.calls['ses_paths'].append(path)
        if not self._ses_ok:
            return False
        FAKE_SES_TEXT.append(io.open(path, encoding='utf8').read())
        return True

    def Refresh(self):
        self.calls['refresh'] = True

FAKE_REG = []
FAKE_SES_TEXT = []
MSGS = []

class FakeWx:
    ICON_ERROR, ICON_INFORMATION = 1, 2
    @staticmethod
    def MessageBox(text, title, style=0):
        MSGS.append(text)

def load_plugin(fake_pcb, env=None, copy_to_tmp=False):
    """隔离加载插件模块：fake pcbnew/wx 注入 sys.modules，env 控制解析路径。"""
    old_sys = set(sys.modules)
    sys.modules['pcbnew'] = fake_pcb
    sys.modules['wx'] = FakeWx
    src = PLUGIN_SRC
    if copy_to_tmp:
        tmp = tempfile.mkdtemp(prefix='pcbplug-')
        os.makedirs(os.path.join(tmp, 'kicad-plugin'))
        shutil.copy(PLUGIN_SRC, os.path.join(tmp, 'kicad-plugin', 'p.py'))
        src = os.path.join(tmp, 'kicad-plugin', 'p.py')
    old_env = {k: os.environ.get(k) for k in ('PCB_STUDIO_HOME', 'PCB_STUDIO_NODE', 'PCB_STUDIO_VIA_COST')}
    for k in old_env:
        if env and k in env:
            os.environ[k] = env[k]
        else:
            os.environ.pop(k, None)
    try:
        spec = importlib.util.spec_from_file_location('pcb-studio-router-test', src)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod, (os.path.dirname(src) if copy_to_tmp else None)
    finally:
        pass  # env 恢复在各测试尾部手工进行（setUp/tearDown 统一做）

class T(unittest.TestCase):
    def setUp(self):
        FAKE_REG.clear(); FAKE_SES_TEXT.clear(); MSGS.clear()

    def tearDown(self):
        for k in ('PCB_STUDIO_HOME', 'PCB_STUDIO_NODE', 'PCB_STUDIO_VIA_COST'):
            os.environ.pop(k, None)
        sys.modules.pop('pcbnew', None)
        sys.modules.pop('wx', None)

    def _plugin(self):
        # 插件模块加载即 register——取注册实例
        self.assertTrue(FAKE_REG, '插件加载时应注册 ActionPlugin 实例')
        return FAKE_REG[-1]

    def test_repo_root_via_env(self):
        fake = FakePcbnew()
        mod, _ = load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        self.assertEqual(mod._repo_root(), REPO)

    def test_repo_root_auto_infer(self):
        # 插件被拷贝到 <临时仓库>/kicad-plugin/ 下；临时仓库造 ai/pcb.mjs → 自动推断
        fake = FakePcbnew()
        mod, plugdir = load_plugin(fake, copy_to_tmp=True)
        tmp = os.path.dirname(plugdir)   # copy 仓库根（plugdir=<root>/kicad-plugin）
        os.makedirs(os.path.join(tmp, 'ai'))
        io.open(os.path.join(tmp, 'ai', 'pcb.mjs'), 'w').write('// marker')
        root = mod._repo_root()
        self.assertTrue(root and os.path.isfile(os.path.join(root, 'ai', 'pcb.mjs')),
            '自动推断应命中临时仓库根: ' + str(root))

    def test_repo_root_missing(self):
        fake = FakePcbnew()
        mod, _ = load_plugin(fake, env={'PCB_STUDIO_HOME': ''}, copy_to_tmp=True)
        # copy_to_tmp 的临时目录父级没有 ai/pcb.mjs——但插件文件名是 p.py，仍在其
        # kicad-plugin/ 下，父目录无 ai/ → 应返回 None
        self.assertIsNone(mod._repo_root())

    def test_run_full_chain(self):
        fake = FakePcbnew()
        load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        self._plugin().defaults()
        self._plugin().Run()
        self.assertTrue(fake.calls['dsn_paths'], 'ExportSpecctraDSN 被调')
        self.assertTrue(fake.calls['ses_paths'], 'ImportSpecctraSES 被调')
        self.assertTrue(fake.calls.get('refresh'), '画布刷新')
        # SES 回读内容是合法 Specctra 会话（network_out 存在）——引擎 importSES 侧语义
        ses = FAKE_SES_TEXT[0]
        self.assertIn('(session', ses)
        self.assertIn('network_out', ses)
        self.assertIn('(net SIG', ses)   # 无特殊字符网名不加引号（_dsnEsc 规则）
        # 弹窗含布通状态
        self.assertTrue(any('布线完成' in m for m in MSGS), MSGS)
        self.assertTrue(any('complete' in m or '连通' in m for m in MSGS), MSGS)
        # 全程无错误弹窗
        self.assertFalse(any('失败' in m for m in MSGS), MSGS)

    def test_run_node_missing(self):
        fake = FakePcbnew()
        load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        # PCB_STUDIO_NODE 指到必然不存在的路径 → which 也找不到
        os.environ['PCB_STUDIO_NODE'] = os.path.join(tempfile.gettempdir(), 'no-such-node-xyz')
        self._plugin().Run()
        self.assertTrue(any('node' in m for m in MSGS), MSGS)
        self.assertFalse(fake.calls['dsn_paths'], 'node 缺失时不应导出 DSN')

    def test_run_dsn_export_fail(self):
        fake = FakePcbnew(dsn_ok=False)
        load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        self._plugin().Run()
        self.assertTrue(any('ExportSpecctraDSN' in m and '失败' in m for m in MSGS), MSGS)
        self.assertFalse(fake.calls['ses_paths'], 'DSN 失败不应回读 SES')

    def test_run_ses_import_fail(self):
        fake = FakePcbnew(ses_ok=False)
        load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        self._plugin().Run()
        self.assertTrue(any('ImportSpecctraSES' in m and '失败' in m for m in MSGS), MSGS)

    def test_run_route_output_not_json(self):
        # route 输出非 JSON（容错：connected 提取失败不崩、仍回读 SES）
        fake = FakePcbnew()
        mod, _ = load_plugin(fake, env={'PCB_STUDIO_HOME': REPO})
        orig_run = mod._run
        def noisy_run(node, cli, args, cwd):
            out = orig_run(node, cli, args, cwd)   # 真跑（result.json 必须落盘）
            if args and args[0] == 'route':
                return 'NOT-JSON-OUTPUT'           # 输出污染 → JSON 解析走容错分支
            return out
        mod._run = noisy_run   # 实例级替换（Run 内 self._run 查找命中）
        self._plugin().Run()
        self.assertTrue(any('布线完成' in m for m in MSGS), MSGS)
        self.assertTrue(fake.calls.get('refresh'))

if __name__ == '__main__':
    unittest.main(verbosity=2)
