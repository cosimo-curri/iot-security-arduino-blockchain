# Hardware and serial connection

The demonstration uses an Arduino Uno Rev3, an LM35 temperature sensor and a computer running the Node.js server. The communication path uses a USB serial bridge rather than an Ethernet Shield.

1. Install Arduino IDE and the **Arduino AVR Boards** core from Boards Manager. Select **Arduino Uno** as the board.
2. In Arduino IDE select **Sketch > Include Library > Add .ZIP Library...** and install `third_party/ascon-suite-master.zip` and `third_party/micro-ecc-master.zip` separately (paths relative to the repository root). These archives contain `library.properties` for **ASCON 0.3.0** and **micro-ecc 1.0.0**. Avoid substituting current upstream versions without testing the protocol.
3. Connect LM35 supply and ground according to the datasheet for the sensor's exact package, then connect its analog output to **A0**. Confirm the pinout before applying power; package orientation matters.
4. Leave **A1** electrically unconnected for the timing-based entropy sampling. This is **not a cryptographically secure random-number generator**.
5. Connect the Arduino by USB and select its serial port (`COM...` on Windows, `/dev/ttyACM...` on Linux, or `/dev/cu.usbmodem...` on macOS).
6. In Arduino IDE open `arduino/curri_jawhariidrissi/curri_jawhariidrissi.ino`, then use **Sketch > Verify/Compile** and **Upload**. The sketch's other `.ino` files and `apis.h` must remain alongside the main file in the same sketch directory. If using a locally provisioned `device_identity.h`, keep that private file in this directory; otherwise the firmware generates an ephemeral signing key.
7. Start the Node.js server with `ARDUINO_COM_PORT` set to the device path, and reset the Arduino after the server is listening. For an unprovisioned demonstration, `ALLOW_UNREGISTERED_SIGNERS=true` must be set explicitly; otherwise enroll the public key of the provisioned device as described in the main README.

The serial baud rate is **9600**. The firmware takes **one** temperature measurement per reset. It sends newline-terminated JSON requests and expects newline-terminated text responses. The Node.js bridge forwards the two requests to local HTTP routes. Do not additionally open the Arduino Serial Monitor while the Node.js process owns the port.

