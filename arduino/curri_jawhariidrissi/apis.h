#ifndef ARDUINO_BLOCKCHAIN_APIS_H
#define ARDUINO_BLOCKCHAIN_APIS_H

#include <Arduino.h>

const char API_ARDUINO_PUBLIC1[] = "/api/arduinoPublic1";
const char API_NEW_MEASURE[] = "/api/newMeasure";

// Implemented using the same micro-ecc RNG callback as the key generation.
bool fillRandomBytes(uint8_t* output, size_t length);
void printHex(const uint8_t* bytes, size_t length);
bool parseEcdhPublicKey(String response, uint8_t* output, size_t length);

#endif
