"""Quandong Cyber OT digital twin: lakehouse logic shared by the pipeline and the unit tests.

Everything here is plain PySpark (DataFrame in, DataFrame out) so it can be tested locally with small
handcrafted DataFrames. The Lakeflow pipeline sources in ``src/pipeline`` only wire these functions
to datasets.
"""
