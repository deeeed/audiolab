#!/usr/bin/env python3
"""Capture the selected iOS device through its modern developer service."""
import asyncio
import re
import sys
from pathlib import Path

from pymobiledevice3.remote.userspace_tunnel import establish_userspace_rsd
from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot


async def capture(device, output):
    rsd = await establish_userspace_rsd(serial=device)
    try:
        if rsd.udid != device:
            raise ValueError("The developer service resolved a different device")
        async with DvtProvider(rsd) as provider, Screenshot(provider) as screen:
            image = await screen.get_screenshot()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(image)
    finally:
        await rsd.close()


if __name__ == "__main__":
    device, app, filename = sys.argv[1:]
    if not re.fullmatch(r"[A-Fa-f0-9-]{16,36}", device):
        raise ValueError("Invalid device identifier")
    if app not in ("playground", "sherpa-voice"):
        raise ValueError("Unknown app")
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,240}\.png", filename):
        raise ValueError("Invalid screenshot filename")
    root = Path(__file__).resolve().parents[3]
    output = root / "apps" / app / ".agent" / "screenshots" / filename
    asyncio.run(capture(device, output))
