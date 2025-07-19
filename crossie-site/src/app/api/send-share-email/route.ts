import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { toEmail, toUsername, projectName, fromUsername, role } = await request.json();

    // For now, we'll simulate email sending
    // In production, you would integrate with:
    // - Resend (https://resend.com/)
    // - SendGrid
    // - Mailgun
    // - AWS SES
    // etc.

    const emailContent = `
      Hi ${toUsername},

      ${fromUsername} has shared a project with you on Crossie!

      Project: "${projectName}"
      Your access level: ${role}

      You can now view and ${role === 'editor' ? 'edit' : 'view'} annotations in this project.

      Visit https://trycrossie.vercel.app to get started.

      Best regards,
      The Crossie Team
    `;

    // Simulate sending email (replace with actual email service)
    console.log('Email would be sent to:', toEmail);
    console.log('Email content:', emailContent);

    // If using a real email service, you would do something like:
    /*
    const emailService = new EmailService(); // Your chosen service
    await emailService.send({
      to: toEmail,
      subject: `${fromUsername} shared a project with you on Crossie`,
      text: emailContent,
      html: generateHTMLEmail(toUsername, fromUsername, projectName, role)
    });
    */

    return NextResponse.json({ 
      success: true, 
      message: 'Share notification sent successfully' 
    });

  } catch (error) {
    console.error('Failed to send share email:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send notification' },
      { status: 500 }
    );
  }
}

function generateHTMLEmail(toUsername: string, fromUsername: string, projectName: string, role: string) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1e293b; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f8fafc; }
        .button { 
          display: inline-block; 
          padding: 12px 24px; 
          background: #3b82f6; 
          color: white; 
          text-decoration: none; 
          border-radius: 6px; 
          margin: 20px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Crossie</h1>
        </div>
        <div class="content">
          <h2>You've been invited to collaborate!</h2>
          <p>Hi ${toUsername},</p>
          <p><strong>${fromUsername}</strong> has shared a project with you on Crossie.</p>
          <p><strong>Project:</strong> "${projectName}"</p>
          <p><strong>Your access level:</strong> ${role}</p>
          <p>You can now ${role === 'editor' ? 'view and edit' : 'view'} annotations in this project.</p>
          <a href="https://trycrossie.vercel.app" class="button">Get Started</a>
          <p>Best regards,<br>The Crossie Team</p>
        </div>
      </div>
    </body>
    </html>
  `;
} 