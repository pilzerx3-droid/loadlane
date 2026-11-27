# ADR 0007: Calculation snapshots

Status: Accepted

A calculation freezes its inputs, applied tariff versions and cost lines when computed. Tariff changes only affect new calculations. Markup, margin on price and absolute contribution are stored separately.
