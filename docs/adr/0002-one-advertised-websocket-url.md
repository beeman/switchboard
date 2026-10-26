# One Advertised WebSocket URL

Each OTA response from an Instance carries one WebSocket URL. A browser on the tailnet and a Device on a LAN can both call OTA at different hostnames, but they then receive the same Advertised WebSocket URL, so that URL has to be one both can open. Two audiences that cannot open the same URL are two Instances.

The Voice server has no second advertised address to rewrite per caller. Leaving a per-client rewrite to the Client would not help a Device, which reads the OTA response itself.
