const assert = require('node:assert/strict');
const { saveSupportSubmission } = require('../server/support');

(async () => {
  const uploads = [], removals = [], rows = [];
  let failInsert = false;
  const admin = {
    storage:{ from(bucket){
      assert.equal(bucket, 'support-attachments');
      return {
        async upload(path, bytes, options){ uploads.push({ path, bytes, options }); return { error:null }; },
        async remove(paths){ removals.push(paths); return { error:null }; },
      };
    } },
    from(table){
      assert.equal(table, 'support_submissions');
      return { async insert(row){ rows.push(row); return { error:failInsert ? new Error('database unavailable') : null }; } };
    },
  };
  const user = { id:'test-user', email:'account@example.com' };
  const image = Buffer.from('test image bytes').toString('base64');
  const issue = await saveSupportSubmission(admin, user, { kind:'issue', topic:'Chat or agent', description:'The chat stopped.', images:[{ mime:'image/png', data:image }] });
  assert.equal(rows[0].id, issue.id);
  assert.equal(rows[0].user_id, user.id);
  assert.deepEqual(rows[0].attachments, [uploads[0].path]);
  assert.deepEqual(Buffer.from(uploads[0].bytes), Buffer.from('test image bytes'));
  assert.equal(uploads[0].options.contentType, 'image/png');
  assert.equal(rows[0].email, user.email);
  await saveSupportSubmission(admin, user, { kind:'feedback', name:'Taylor', email:'taylor@example.com', topic:'Question', description:'Please help.' });
  assert.equal(rows[1].kind, 'feedback');
  assert.equal(rows[1].name, 'Taylor');
  await assert.rejects(() => saveSupportSubmission(admin, user, { kind:'issue', topic:'Other', description:'Bad image', images:[{ mime:'image/png', data:'!' }] }), error => error.code === 'BAD_INPUT');
  failInsert = true;
  await assert.rejects(() => saveSupportSubmission(admin, user, { kind:'issue', topic:'Other', description:'Retry', images:[{ mime:'image/png', data:image }] }));
  assert.deepEqual(removals, [[uploads[1].path]]);
  console.log('support storage: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
