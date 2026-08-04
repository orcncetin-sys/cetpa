import { mikroSql } from '../src/services/mikroSql';
async function test() {
  const result = await mikroSql("SELECT TOP 1 * FROM PERSONEL_TANIMLARI");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
test();
