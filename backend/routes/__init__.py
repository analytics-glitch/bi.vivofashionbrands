"""Route modules — incrementally extracted from server.py.

Each submodule MUST be imported from server.py *after* all shared
helpers are defined (i.e. just above ``app.include_router(api_router)``)
because the route decorators register against ``server.api_router``
on import.
"""
