"""Provider adapters.

Importing this package registers every built-in adapter, so any caller that
touches `app.providers` gets a populated registry. Registration used to depend
on the entrypoint importing each adapter module, which meant scripts and tests
silently saw an empty registry.
"""
from . import base  # noqa: F401  (re-exported for convenience)


def _register_builtin_adapters() -> None:
    # Imported for side effects: each module calls `base.register(...)`.
    from . import open_meteo  # noqa: F401
    from .metoffice import datahub  # noqa: F401


_register_builtin_adapters()
