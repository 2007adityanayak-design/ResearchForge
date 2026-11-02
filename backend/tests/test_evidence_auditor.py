import unittest

from ai.evidence_auditor import audit_project_evidence


class EvidenceAuditorTests(unittest.TestCase):

    def audit(self, sections, notes=""):
        return audit_project_evidence({
            "name": "Evidence Auditor Test",
            "document_type": "project_report",
            "problem_statement": "Test evidence consistency.",
            "research_objectives": "Test implementation status.",
            "research_notes": notes,
            "sections": sections,
            "figures": [],
            "tables": [],
        })

    def test_manual_and_automatic_operation_conflict(self):
        findings = self.audit({
            "Implementation": (
                "The prototype is manually operated using a physical switch."
            ),
            "System Operation": (
                "The prototype operates automatically using an LDR sensor."
            ),
        })

        categories = {item["category"] for item in findings}
        self.assertIn("implementation_status", categories)

    def test_automatic_operation_not_implemented(self):
        findings = self.audit({
            "Implementation": (
                "Automatic operation using an LDR sensor is not implemented."
            ),
            "System Operation": (
                "The prototype uses automatic operation."
            ),
        })

        categories = {item["category"] for item in findings}
        self.assertIn("implementation_status", categories)

    def test_solar_power_future_and_current_conflict(self):
        findings = self.audit({
            "Implementation": (
                "The current prototype uses a solar-powered system."
            ),
            "Future Work": (
                "Solar-powered operation is planned for future development."
            ),
        })

        categories = {item["category"] for item in findings}
        self.assertIn("hardware_implementation_status", categories)



    def test_unsupported_numerical_claim_is_flagged(self):
        findings = audit_project_evidence({
            "name": "Numerical Integrity Test",
            "research_notes": "The prototype uses a 365 nm UV LED.",
            "sections": {
                "Implementation": "The prototype uses a 450 nm UV LED."
            },
            "figures": [],
            "tables": [],
        })

        categories = {item["category"] for item in findings}
        self.assertIn("numerical_integrity", categories)

    def test_supported_numerical_claim_is_not_flagged(self):
        findings = audit_project_evidence({
            "name": "Numerical Integrity Test",
            "research_notes": "The prototype uses a 365 nm UV LED.",
            "sections": {
                "Implementation": "The prototype uses a 365 nm UV LED."
            },
            "figures": [],
            "tables": [],
        })

        numerical_findings = [
            item for item in findings
            if item["category"] == "numerical_integrity"
        ]
        self.assertEqual(numerical_findings, [])


if __name__ == "__main__":
    unittest.main()
