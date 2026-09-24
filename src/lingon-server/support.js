// Account support submissions are saved to Supabase; screenshots go in a private bucket.
const IMAGE_TYPES = { 'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp', 'image/gif':'gif' };

function validate(body) {
  try {
  const kind = String(body?.kind || '');
  if (!['issue', 'feedback'].includes(kind)) throw new Error('Choose a submission type.');
  const description = String(body?.description || '').trim();
  if (!description || description.length > 4000) throw new Error('Describe the issue in 4000 characters or fewer.');
  const topic = String(body?.topic || '').trim();
  if (kind === 'issue' && (!topic || topic.length > 100)) throw new Error('Choose what the problem is related to.');
  const name = String(body?.name || '').trim();
  const email = String(body?.email || '').trim().toLowerCase();
  if (kind === 'feedback' && (!name || name.length > 120 || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !topic || topic.length > 120)) {
    throw new Error('Add your name, a valid email and a topic.');
  }
  const images = body?.images || [];
  if (!Array.isArray(images) || images.length > 3 || (kind === 'feedback' && images.length)) throw new Error('Attach up to three images.');
  const parsed = images.map((image) => {
    const mime = String(image?.mime || '');
    const data = String(image?.data || '');
    if (!IMAGE_TYPES[mime] || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 2800000) throw new Error('Images must be PNG, JPEG, WebP or GIF, up to 2 MB each.');
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new Error('Each image must be 2 MB or smaller.');
    return { mime, bytes, extension: IMAGE_TYPES[mime] };
  });
  return { kind, description, topic, name, email, images:parsed };
  } catch (error) {
    error.code = 'BAD_INPUT';
    throw error;
  }
}

async function saveSupportSubmission(admin, user, body) {
  const input = validate(body);
  const id = crypto.randomUUID();
  const uploaded = [];
  try {
    for (let i = 0; i < input.images.length; i++) {
      const image = input.images[i];
      const path = `${user.id}/${id}/${i + 1}.${image.extension}`;
      const { error } = await admin.storage.from('support-attachments').upload(path, image.bytes, { contentType:image.mime, upsert:false });
      if (error) throw error;
      uploaded.push(path);
    }
    const { error } = await admin.from('support_submissions').insert({
      id, user_id:user.id, kind:input.kind, name:input.kind === 'feedback' ? input.name : null,
      email:input.kind === 'feedback' ? input.email : user.email || null,
      topic:input.topic, description:input.description, attachments:uploaded,
    });
    if (error) throw error;
    return { id };
  } catch (error) {
    if (uploaded.length) await admin.storage.from('support-attachments').remove(uploaded).catch(() => {});
    throw error;
  }
}

export { saveSupportSubmission };
