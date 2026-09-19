"""Puts eval-service on sys.path for the tests, and lets a local .env supply the judge key."""

import envfile

envfile.load_env()
