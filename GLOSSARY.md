# Switchboard

A Switchboard Instance is something you can start and point devices at. This repo defines the Instance. It does not contain the voice server's source.

## Language

**Instance**:
One running Switchboard. Devices and the Client connect to an Instance.
_Avoid_: Stack, deployment, server

**Voice server**:
The process in an Instance that speaks the Xiaozhi OTA and WebSocket protocol.
_Avoid_: Xiaozhi, console, manager

**Client**:
The web page this repo owns. It talks to one Instance.
_Avoid_: Digital human, test page

**Device**:
Hardware or another application that uses the same OTA and WebSocket protocol as the Client.
_Avoid_: ESP32, board

**Speech**:
The local process in an Instance that turns reply text into audio.
_Avoid_: EdgeTTS, cloud voice

**Advertised WebSocket URL**:
The single WebSocket URL an Instance puts in every OTA response. Every Client and Device of that Instance receives the same one.
_Avoid_: Public URL, callback URL

**Instance config**:
The settings that make one Instance different from another, including the Advertised WebSocket URL. It is not part of the image.
_Avoid_: Lab file, secrets file

**Console**:
The part of an Instance where a person registers, creates an agent, and binds a Device. While it is on, it supplies the voice server's module settings.
_Avoid_: Manager, 智控台, control panel
