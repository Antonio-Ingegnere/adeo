#!/usr/bin/env python3
"""Temporary compatibility shim for package.json left from the old SDD workflow.

The old resolve-approved-plan runtime is intentionally gone. The real workflow
self-test is delivery-selftest.py; this file only keeps an existing
`npm run test:workflow` command from failing until package.json is simplified.
"""
print("Legacy SDD self-test shim: no-op (delivery-selftest.py is authoritative)")
