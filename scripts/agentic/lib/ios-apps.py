#!/usr/bin/env python3
"""List installed bundle IDs on the selected physical iOS device."""
import asyncio
import json
import sys

from pymobiledevice3.lockdown import create_using_usbmux
from pymobiledevice3.services.installation_proxy import InstallationProxyService


async def installed_apps(device):
    phone = await create_using_usbmux(serial=device)
    try:
        if phone.udid != device:
            raise ValueError("The installation service resolved a different device")
        return sorted(await InstallationProxyService(phone).get_apps())
    finally:
        await phone.close()


if __name__ == "__main__":
    print(json.dumps(asyncio.run(installed_apps(sys.argv[1]))))
