from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from validate_struder_lua import validate_source


class StruderLuaValidatorTests(unittest.TestCase):
    def test_accepts_single_continuous_extrusion_window(self):
        source = """
        function RunCube()
            PenOff()
            PenOn()
            L(1, 2, 3, 4)
            DO(PEN_DO, 0)
        end
        """
        self.assertEqual(validate_source(source), [])

    def test_rejects_mid_program_stop_start(self):
        source = """
        function RunCube()
            PenOff()
            PenOn()
            L(1, 2, 3, 4)
            PenOff()
            PenOn()
        end
        """
        errors = validate_source(source)
        self.assertTrue(errors)
        self.assertTrue(any("PenOn" in error for error in errors))
        self.assertTrue(any("PenOff" in error for error in errors))

    def test_requires_explicit_override_for_cycling_experiment(self):
        source = """
        -- ALLOW_EXTRUSION_CYCLING: true
        function RunCube()
            PenOn()
            PenOff()
            PenOn()
            PenOff()
        end
        """
        self.assertEqual(validate_source(source), [])


if __name__ == "__main__":
    unittest.main()
