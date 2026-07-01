"""SLICE 1 — library/github_app.py tests.

Covers webhook signature verification (HMAC-SHA256 / compare_digest), App JWT
(RS256), and installation-token minting/caching. Later tasks append to this file.
"""
import base64
import hashlib
import hmac
import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

import config
