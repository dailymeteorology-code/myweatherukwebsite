# TCM V5 engine (vendored)

A copy of `ukv-platform/backend/app`, the TCM V5 physics, so GitHub Actions can run it for
TCM NOVA. NOVA calls it through `tools/tcm-nova/nova/v5_bridge.py` and `v5_run.py`. No keys
or data live here; the field store is written to `NOVA_V5_STORE` (D:/TCM-NOVA/v5 locally).
