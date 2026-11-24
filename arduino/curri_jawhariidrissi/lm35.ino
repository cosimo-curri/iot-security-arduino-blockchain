double get_temperature() {
  int v = analogRead(A0);
  double vt = (float)(5000.0d/1024.0d)*(float)v;
  double temp = vt/10.0d;

  return temp;
}