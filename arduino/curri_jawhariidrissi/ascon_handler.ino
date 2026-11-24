#include <ASCON.h>
#include "apis.h"

bool generateRandom(uint8_t* bytes, size_t length) {
  return fillRandomBytes(bytes, length);
}

void generate_ascon_hash(const uint8_t* data, size_t dataLength, uint8_t* output) {
  ascon_hash_state_t state;
  ascon_hash_init(&state);
  ascon_hash_update(&state, data, dataLength);
  ascon_hash_finalize(&state, output);
}
