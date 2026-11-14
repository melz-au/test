"""Gold: detections, incidents, site health, compliance status and the detection scorecard.

Only gold_detection_scorecard reads the restricted ground-truth table.
"""

from pyspark import pipelines as dp

from quandong import detections, health, incidents, scorecard


@dp.materialized_view(
    name="gold_detections",
    comment="Rule-based findings (one row per finding) with MITRE ATT&CK for ICS techniques and correlation IDs.",
    table_properties={"quality": "gold"},
)
def gold_detections():
    findings = detections.all_detections(
        remote_access=spark.read.table("silver_remote_access"),
        protocol_events=spark.read.table("silver_protocol_events"),
        process_telemetry=spark.read.table("silver_process_telemetry"),
        asset_inventory=spark.read.table("silver_asset_inventory"),
        network_flows=spark.read.table("silver_network_flows"),
    )
    return incidents.assign_correlation(findings)


@dp.materialized_view(
    name="gold_incidents",
    comment="Findings grouped by correlation_id, with a plain-English summary.",
    table_properties={"quality": "gold"},
)
def gold_incidents():
    return incidents.incidents(spark.read.table("gold_detections"), spark.read.table("silver_security_alerts"))


@dp.materialized_view(
    name="gold_site_health",
    comment="Per site per hour: uptime, data completeness and alert counts.",
    table_properties={"quality": "gold"},
)
def gold_site_health():
    return health.site_health(
        spark.read.table("silver_process_telemetry"),
        spark.read.table("silver_security_alerts"),
        spark.read.table("gold_detections"),
    )


@dp.materialized_view(
    name="gold_compliance_status",
    comment="Latest status per control, for board attestation.",
    table_properties={"quality": "gold"},
)
def gold_compliance_status():
    return health.compliance_status(spark.read.table("silver_compliance_evidence"))


@dp.materialized_view(
    name="gold_detection_scorecard",
    comment="Detections scored against planted scenarios (ground truth): detection rate and time to detect.",
    table_properties={"quality": "gold", "quandong.restricted": "true"},
)
def gold_detection_scorecard():
    return scorecard.detection_scorecard(spark.read.table("silver_scenario_log"), spark.read.table("gold_detections"))
