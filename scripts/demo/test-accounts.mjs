// Temporary staff accounts of the automated tests (test:api, test:ui, test:auth). They are recognised only by
// fixed address prefixes on example.com and never carry the demo marker, so real accounts and the demo staff
// are never touched.
export const TEST_ACCOUNT = /^(api|ui|e2e)-[a-z0-9-]+@example\.com$/;

export const isTestAccount = (user) => TEST_ACCOUNT.test(user.email ?? "") && !user.app_metadata?.demo_seed;

const BLOCKED = "876000h";

// Removes test accounts after their demo-flagged test requests are gone (demo:seed). An account that is still
// referenced (e.g. by live data) is deactivated and its login blocked instead of deleted.
export async function cleanupTestAccounts(admin) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Nutzer konnten nicht gelesen werden: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < 200) break;
  }
  const result = { deleted: 0, deactivated: 0 };
  for (const user of users.filter(isTestAccount)) {
    await admin.from("employee_availability").delete().eq("employee_id", user.id);
    const { error: profileError } = await admin.from("profiles").delete().eq("id", user.id);
    if (profileError) {
      await deactivateTestAccounts(admin, [user.id]);
      result.deactivated += 1;
      continue;
    }
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`${user.email}: ${error.message}`);
    result.deleted += 1;
  }
  return result;
}

// End of a test run: own accounts stay for inspection but no longer appear as active staff
export async function deactivateTestAccounts(admin, ids) {
  const list = ids.filter(Boolean);
  if (list.length === 0) return;
  await admin.from("profiles").update({ is_active: false }).in("id", list);
  for (const id of list) await admin.auth.admin.updateUserById(id, { ban_duration: BLOCKED });
}
