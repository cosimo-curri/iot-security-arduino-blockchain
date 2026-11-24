#include <uECC.h>
#include "apis.h"

// The optional private signing-key header is generated locally by npm run provision:device.
#if defined(__has_include)
#if __has_include("device_identity.h")
#include "device_identity.h"
#define ARDUINO_HAS_PROVISIONED_IDENTITY 1
#endif
#endif

// The analog timing source is bounded so a stable ADC signal cannot hang
// the device indefinitely. It is NOT a certified hardware TRNG and is
// unsuitable for production cryptography.
static int RNG(uint8_t* output, unsigned size) {
  for (unsigned index = 0; index < size; ++index) {
    uint8_t value = 0;
    for (unsigned bit = 0; bit < 8; ++bit) {
      const int initial = analogRead(A1); // Unconnected analog input, not LM35 on A0.
      const unsigned long start = micros();
      unsigned count = 0;
      while (analogRead(A1) == initial && micros() - start < 10000UL) {
        ++count;
      }
      if (micros() - start >= 10000UL) return 0;
      value = static_cast<uint8_t>((value << 1) | (count & 1U));
    }
    output[index] = value;
  }
  return 1;
}

bool fillRandomBytes(uint8_t* output, size_t length) {
  if (!output || length > 65535) return false;
  return RNG(output, static_cast<unsigned>(length)) == 1;
}

bool get_shared_secret(uint8_t* secret, size_t secretSize) {
  if (!secret || secretSize < 20) return false;
  uECC_set_rng(&RNG);
  const struct uECC_Curve_t* curve = uECC_secp160r1();
  uint8_t privateKey[21];
  uint8_t publicKey[40];
  if (!uECC_make_key(publicKey, privateKey, curve)) return false;

  Serial.print("{\"api\":\"");
  Serial.print(API_ARDUINO_PUBLIC1);
  Serial.print("\",\"value\":{\"public1_hex\":\"04");
  printHex(publicKey, sizeof(publicKey));
  Serial.println("\"}}");

  uint8_t serverPublicKey[40];
  if (!parseEcdhPublicKey(get_response(), serverPublicKey, sizeof(serverPublicKey))) {
    return false;
  }
  return uECC_shared_secret(serverPublicKey, privateKey, secret, curve) == 1;
}

bool sign_hash(const uint8_t* hash, size_t hashSize,
               uint8_t* signature, uint8_t* signingPublicKey) {
  if (hashSize != ASCON_HASH_SIZE) return false;
  const struct uECC_Curve_t* curve = uECC_secp192r1();
  uint8_t privateKey[24];
  uint8_t publicKey[48];
#ifdef ARDUINO_HAS_PROVISIONED_IDENTITY
  // Stable signing identity enrolled on the backend. Flash remains extractable
  // from an unprotected Uno; this is NOT a hardware secure element.
  memcpy_P(privateKey, DEVICE_SIGNING_PRIVATE_KEY, sizeof(privateKey));
  memcpy_P(publicKey, DEVICE_SIGNING_PUBLIC_KEY, sizeof(publicKey));
#else
  // Unregistered classroom mode: ephemeral key per reset.
  if (!uECC_make_key(publicKey, privateKey, curve)) return false;
#endif
  signingPublicKey[0] = 0x04;
  memcpy(&signingPublicKey[1], publicKey, sizeof(publicKey));
  const bool success = uECC_sign(privateKey, hash, hashSize, signature, curve) == 1;
  // Clear the temporary RAM copy, including on unsuccessful signatures.
  volatile uint8_t* toClear = privateKey;
  for (size_t i = 0; i < sizeof(privateKey); ++i) toClear[i] = 0;
  return success;
}
