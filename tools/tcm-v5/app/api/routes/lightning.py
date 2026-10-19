"""Lightning endpoints -- three independently switchable layers."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ...forecast import service

router = APIRouter(tags=["lightning"])


@router.get("/lightning/{forecast_hour}")
def lightning(forecast_hour: int) -> dict:
    """All three lightning layers, never merged."""
    return service.lightning_products(forecast_hour).to_dict()


@router.get("/lightning/{forecast_hour}/{kind}")
def lightning_layer(forecast_hour: int, kind: str) -> dict:
    """One layer, for a map toggle."""
    products = service.lightning_products(forecast_hour)
    if kind not in products.layers:
        raise HTTPException(
            404,
            f"unknown lightning layer {kind!r}; "
            f"available: {sorted(products.layers)}",
        )
    return products.layers[kind].to_dict()
