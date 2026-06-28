/** E.164 SendBlue line — must match SENDBLUE_FROM_NUMBER in KleoKlaw backend. */
export function getKleoPhone() {
  return (
    process.env.KLEO_PHONE?.trim() ||
    process.env.SENDBLUE_FROM_NUMBER?.trim() ||
    ""
  );
}
