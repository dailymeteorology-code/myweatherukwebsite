import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { request_id, status, admin_notes } = await req.json();

    if (!request_id || !status || !['approved', 'rejected'].includes(status)) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 });
    }

    const accessRequest = await base44.asServiceRole.entities.AccessRequest.get(request_id);

    if (!accessRequest) {
      return Response.json({ error: 'Access request not found' }, { status: 404 });
    }

    await base44.asServiceRole.entities.AccessRequest.update(request_id, {
      status,
      admin_notes: admin_notes || '',
      email_sent: false
    });

    const emailSubject = status === 'approved' 
      ? 'Your Access Request Has Been Approved' 
      : 'Your Access Request Has Been Declined';

    const emailBody = status === 'approved'
      ? `Dear ${accessRequest.full_name},\n\nGreat news! Your access request has been approved. You now have access to the site.\n\nYou can log in using the email address: ${accessRequest.email}\n\nBest regards,\nThe Site Administrator`
      : `Dear ${accessRequest.full_name},\n\nThank you for your interest in accessing this site. Unfortunately, your access request has been declined.\n\n${admin_notes ? `Reason: ${admin_notes}` : ''}\n\nIf you have any questions, please reach out to the site administrator.\n\nBest regards,\nThe Site Administrator`;

    await base44.integrations.Core.SendEmail({
      to: accessRequest.email,
      subject: emailSubject,
      body: emailBody
    });

    await base44.asServiceRole.entities.AccessRequest.update(request_id, {
      email_sent: true
    });

    return Response.json({ success: true, message: `Request ${status}. Email sent to ${accessRequest.email}` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});