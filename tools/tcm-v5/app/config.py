"""Runtime configuration.

Every value comes from the environment (see `.env.example`). Nothing here is
ever shipped to the browser: the backend is the only process that reads it.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"), env_file_encoding="utf-8", extra="ignore"
    )

    # --- Met Office Weather DataHub ---------------------------------------
    metoffice_atmospheric_api_key: str = ""
    metoffice_atmospheric_base_url: str = (
        "https://data.hub.api.metoffice.gov.uk/atmospheric-models/1.0.0"
    )
    # The DataHub "order" that defines which UKV parameters are delivered.
    # Orders are created in the DataHub portal; there is no order-creation API.
    metoffice_order_id: str = ""

    # --- National Severe Weather Warning Service --------------------------
    #
    # The old IBM API Connect host (api-metoffice.apiconnect.ibmcloud.com)
    # still resolves in DNS but refuses every connection; NSWWS now sits
    # behind the same WSO2 gateway as the DataHub APIs.
    #
    # Verified 2026-08-30 against the supplied key:
    #   * the key authenticates -- offered to the ATMOSPHERIC API it returns
    #     403 "Resource forbidden" (valid, not subscribed), not 401;
    #   * /nswws/v1.1/<anything> returns 404 "No matching resource found for
    #     given API Request", which is WSO2 for "the context is deployed but
    #     that path is not one of its resources";
    #   * /nswws/<anything> returns "The requested resource is not
    #     available", i.e. no such context.
    #
    # So the host and the credentials are right and only the resource path is
    # unknown. It is in the NSWWS API definition on the Met Office portal;
    # set it here or as METOFFICE_NSWWS_PATH and the adapter will use it.
    metoffice_nswws_api_key: str = ""
    metoffice_nswws_base_url: str = (
        "https://data.hub.api.metoffice.gov.uk/nswws/v1.1"
    )
    #: Resource path under the base URL, e.g. "/warnings". Empty until the
    #: real one is known -- the platform will not guess an endpoint.
    metoffice_nswws_path: str = ""

    # --- Open-Meteo (secondary model aggregation) -------------------------
    open_meteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_ensemble_url: str = "https://ensemble-api.open-meteo.com/v1/ensemble"
    # Optional commercial key; blank uses the free tier.
    open_meteo_api_key: str = ""
    #: Sampling mesh in degrees for the Open-Meteo models. The free tier
    #: weights quota by locations x variables x days: a 0.5 degree mesh
    #: (621 points, 4 models, 19 variables) exhausts the DAILY allowance
    #: part-way through one cube build -- measured, not estimated. Coarsen
    #: this to fit the free tier, or set a commercial key and refine it.
    #: The recorded resolution follows this value automatically.
    open_meteo_sample_deg: float = 0.5

    # --- ECMWF open data ---------------------------------------------------
    ecmwf_opendata_url: str = "https://data.ecmwf.int/forecasts"

    # --- Lightning ---------------------------------------------------------
    lightning_provider: str = "none"
    lightning_api_key: str = ""
    lightning_api_url: str = ""
    lightning_poll_seconds: int = 10

    # --- Mode --------------------------------------------------------------
    # live = real provider APIs only. mock = synthetic, tagged MOCK in the UI.
    data_mode: str = "live"

    # --- Persistence -------------------------------------------------------
    # No database server and no container runtime: the catalogue is SQLite and
    # the field store is the local filesystem. The whole platform is a Python
    # process plus a data directory.
    data_root: Path = Path(__file__).resolve().parents[2] / "data"
    disk_quota_gb: int = 60

    # --- App ---------------------------------------------------------------
    log_level: str = "INFO"
    backend_port: int = 8000
    cors_origins: str = "http://localhost:3000"

    @property
    def catalogue_path(self) -> Path:
        return self.data_root / "catalogue.sqlite3"

    @property
    def database_url(self) -> str:
        return f"sqlite:///{self.catalogue_path.as_posix()}"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def raw_dir(self) -> Path:
        return self.data_root / "raw"

    @property
    def field_dir(self) -> Path:
        return self.data_root / "fields"

    def require_atmospheric(self) -> None:
        """Fail loudly rather than silently degrading to a coarser model."""
        if not self.metoffice_atmospheric_api_key:
            raise RuntimeError("METOFFICE_ATMOSPHERIC_API_KEY is not set")
        if not self.metoffice_order_id:
            raise RuntimeError("METOFFICE_ORDER_ID is not set")


@lru_cache
def get_settings() -> Settings:
    return Settings()
