void printHex(const uint8_t* bytes, size_t length) {
  const char digits[] = "0123456789abcdef";
  for (size_t index = 0; index < length; ++index) {
    Serial.write(digits[bytes[index] >> 4]);
    Serial.write(digits[bytes[index] & 0x0F]);
  }
}

static int hexDigit(char character) {
  if (character >= '0' && character <= '9') return character - '0';
  if (character >= 'a' && character <= 'f') return character - 'a' + 10;
  if (character >= 'A' && character <= 'F') return character - 'A' + 10;
  return -1;
}

bool parseEcdhPublicKey(String response, uint8_t* output, size_t length) {
  response.trim();
  if (response.length() != (length + 1) * 2 ||
      response[0] != '0' || response[1] != '4') return false;
  for (size_t index = 0; index < length; ++index) {
    const int high = hexDigit(response[2 + index * 2]);
    const int low = hexDigit(response[3 + index * 2]);
    if (high < 0 || low < 0) return false;
    output[index] = static_cast<uint8_t>((high << 4) | low);
  }
  return true;
}

void doubleToUint8Array(double value, uint8_t* output) {
  memcpy(output, &value, sizeof(value));
}
