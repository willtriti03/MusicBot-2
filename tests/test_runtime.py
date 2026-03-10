import unittest

from musicbot.runtime import LOCKED_RUNTIME, collect_runtime_diagnostics, format_runtime_diagnostics


class RuntimeTest(unittest.TestCase):
    def test_collect_runtime_diagnostics_has_expected_keys(self):
        diagnostics = collect_runtime_diagnostics()
        self.assertIn("python", diagnostics)
        self.assertIn("python_executable", diagnostics)
        for package_name in LOCKED_RUNTIME:
            if package_name == "python":
                continue
            self.assertIn(package_name, diagnostics)

    def test_format_runtime_diagnostics_contains_locked_python(self):
        report = format_runtime_diagnostics()
        self.assertIn("Python: locked", report)


if __name__ == "__main__":
    unittest.main()
