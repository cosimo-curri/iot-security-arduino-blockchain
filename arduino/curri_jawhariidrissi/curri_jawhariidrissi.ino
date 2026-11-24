#include <ASCON.h>
#include "apis.h"

// Arduino Uno/AVR represents double as a 32-bit little-endian float.
static_assert(sizeof(double) == 4, "The wire format requires an AVR 32-bit double");

String get_response(unsigned long timeout = 10000UL) {
  String response;
  const unsigned long started = millis();
  while (millis() - started < timeout) {
    while (Serial.available()) {
      const char character = static_cast<char>(Serial.read());
      if (character == '\n') {
        response.trim();
        return response;
      }
      if (response.length() >= 128) return ""; // Bound line size.
      response += character;
    }
  }
  response.trim();
  return response;
}

void setup() {
  Serial.begin(9600);
  while (!Serial) {}

  uint8_t sharedSecret[20];
  if (!get_shared_secret(sharedSecret, sizeof(sharedSecret))) {
    Serial.println("ERROR: ECDH handshake failed");
    return;
  }

  const double temperature = get_temperature();
  uint8_t nonce[16];
  uint8_t associatedData[16];
  if (!generateRandom(nonce, sizeof(nonce)) ||
      !generateRandom(associatedData, sizeof(associatedData))) {
    Serial.println("ERROR: entropy source failed");
    return;
  }

  uint8_t plaintext[sizeof(double)];
  doubleToUint8Array(temperature, plaintext);
  uint8_t ciphertext[sizeof(plaintext) + ASCON80PQ_TAG_SIZE];
  size_t ciphertextLength = 0;
  ascon80pq_aead_encrypt(ciphertext, &ciphertextLength,
                         plaintext, sizeof(plaintext),
                         associatedData, sizeof(associatedData),
                         nonce, sharedSecret);
  if (ciphertextLength != sizeof(ciphertext)) {
    Serial.println("ERROR: encryption failed");
    return;
  }

  uint8_t hash[ASCON_HASH_SIZE];
  generate_ascon_hash(ciphertext, ciphertextLength, hash);
  uint8_t signature[48];
  uint8_t signingPublicKey[49];
  Serial.println("hash signing in progress...");
  if (!sign_hash(hash, sizeof(hash), signature, signingPublicKey)) {
    Serial.println("ERROR: ECDSA signing failed");
    return;
  }

  Serial.print("{\"api\":\"");
  Serial.print(API_NEW_MEASURE);
  Serial.print("\",\"value\":{\"cipher_text\":\"");
  printHex(ciphertext, ciphertextLength);
  Serial.print("\",\"nonce\":\"");
  printHex(nonce, sizeof(nonce));
  Serial.print("\",\"associated_data\":\"");
  printHex(associatedData, sizeof(associatedData));
  Serial.print("\",\"signature\":\"");
  printHex(signature, sizeof(signature));
  Serial.print("\",\"public_arduino_hash\":\"");
  printHex(signingPublicKey, sizeof(signingPublicKey));
  Serial.println("\"}}");

  Serial.println(get_response(120000UL));
}

void loop() {
  // One measurement per reset.
}
