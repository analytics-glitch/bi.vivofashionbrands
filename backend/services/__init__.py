"""Iter 91m+ — shared service helpers.

Centralised location for cross-endpoint metric definitions. Any helper
exposed here is consumed by multiple FastAPI route handlers and is the
single source of truth for that metric so it cannot drift between
endpoints (per the data-integrity audit framework's residual-risk
recommendation).
"""
