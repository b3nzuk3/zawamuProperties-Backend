// Simple email service for sending property alerts
// In a production environment, you would integrate with services like:
// - SendGrid, Mailgun, AWS SES, or similar

import nodemailer from 'nodemailer'

// Create a transporter (you'll need to configure this with your email service)
const createTransporter = () => {
  // For development, you can use a service like Ethereal Email or Gmail
  // For production, use a proper email service
  return nodemailer.createTransporter({
    // Example Gmail configuration (you'll need to use App Passwords)
    // service: 'gmail',
    // auth: {
    //   user: process.env.EMAIL_USER,
    //   pass: process.env.EMAIL_PASS
    // }

    // For now, we'll use a mock transporter for development
    host: 'smtp.ethereal.email',
    port: 587,
    auth: {
      user: 'ethereal.user@ethereal.email',
      pass: 'ethereal.pass',
    },
  })
}

// Send property alert email
const sendPropertyAlert = async (savedSearch, matchingProperties) => {
  try {
    const transporter = createTransporter()

    const subject = `New Properties Match Your Search: ${savedSearch.name}`

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Property Alert</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #2563eb; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; }
          .property { border: 1px solid #ddd; margin: 15px 0; padding: 15px; border-radius: 8px; }
          .property img { width: 100%; max-width: 300px; height: 200px; object-fit: cover; border-radius: 4px; }
          .property h3 { color: #2563eb; margin: 10px 0; }
          .property p { margin: 5px 0; }
          .price { font-size: 1.2em; font-weight: bold; color: #059669; }
          .footer { background: #f3f4f6; padding: 20px; text-align: center; font-size: 0.9em; }
          .btn { display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px; margin: 10px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏠 New Properties Match Your Search!</h1>
          </div>
          
          <div class="content">
            <p>Hello ${savedSearch.userName},</p>
            
            <p>We found <strong>${
              matchingProperties.length
            }</strong> new properties that match your saved search: <strong>"${
      savedSearch.name
    }"</strong></p>
            
            <h2>Your Search Criteria:</h2>
            <ul>
              ${
                savedSearch.searchCriteria.county
                  ? `<li>Location: ${savedSearch.searchCriteria.county}${
                      savedSearch.searchCriteria.constituency
                        ? `, ${savedSearch.searchCriteria.constituency}`
                        : ''
                    }${
                      savedSearch.searchCriteria.ward
                        ? `, ${savedSearch.searchCriteria.ward}`
                        : ''
                    }</li>`
                  : ''
              }
              ${
                savedSearch.searchCriteria.propertyTypes &&
                savedSearch.searchCriteria.propertyTypes.length > 0
                  ? `<li>Property Types: ${savedSearch.searchCriteria.propertyTypes.join(
                      ', '
                    )}</li>`
                  : ''
              }
              ${
                savedSearch.searchCriteria.minPrice ||
                savedSearch.searchCriteria.maxPrice
                  ? `<li>Price Range: ${
                      savedSearch.searchCriteria.minPrice
                        ? `KSh ${savedSearch.searchCriteria.minPrice.toLocaleString()}`
                        : 'Any'
                    } - ${
                      savedSearch.searchCriteria.maxPrice
                        ? `KSh ${savedSearch.searchCriteria.maxPrice.toLocaleString()}`
                        : 'Any'
                    }</li>`
                  : ''
              }
              ${
                savedSearch.searchCriteria.minBedrooms
                  ? `<li>Min Bedrooms: ${savedSearch.searchCriteria.minBedrooms}</li>`
                  : ''
              }
              ${
                savedSearch.searchCriteria.minBathrooms
                  ? `<li>Min Bathrooms: ${savedSearch.searchCriteria.minBathrooms}</li>`
                  : ''
              }
              ${
                savedSearch.searchCriteria.searchTerm
                  ? `<li>Search Term: "${savedSearch.searchCriteria.searchTerm}"</li>`
                  : ''
              }
            </ul>
            
            <h2>New Matching Properties:</h2>
            
            ${matchingProperties
              .map(
                (property) => `
              <div class="property">
                ${
                  property.images && property.images.length > 0
                    ? `<img src="${property.images[0]}" alt="${property.title}">`
                    : ''
                }
                <h3>${property.title}</h3>
                <p class="price">KSh ${property.price.toLocaleString()}</p>
                <p><strong>Type:</strong> ${property.type}</p>
                <p><strong>Location:</strong> ${
                  property.ward && property.constituency && property.county
                    ? `${property.ward}, ${property.constituency}, ${property.county}`
                    : property.location
                }</p>
                ${
                  property.bedrooms
                    ? `<p><strong>Bedrooms:</strong> ${property.bedrooms}</p>`
                    : ''
                }
                ${
                  property.bathrooms
                    ? `<p><strong>Bathrooms:</strong> ${property.bathrooms}</p>`
                    : ''
                }
                <p>${property.description}</p>
                <a href="${
                  process.env.FRONTEND_URL || 'http://localhost:5173'
                }/listings/${property._id}" class="btn">View Property</a>
              </div>
            `
              )
              .join('')}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${
                process.env.FRONTEND_URL || 'http://localhost:5173'
              }/listings" class="btn">View All Properties</a>
            </div>
          </div>
          
          <div class="footer">
            <p>This alert was sent because you have an active saved search. You can manage your saved searches in your <a href="${
              process.env.FRONTEND_URL || 'http://localhost:5173'
            }/dashboard">dashboard</a>.</p>
            <p>If you no longer wish to receive these alerts, you can disable them in your dashboard.</p>
            <p>© 2024 Zawamu Properties. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `

    const textContent = `
      New Properties Match Your Search: ${savedSearch.name}
      
      Hello ${savedSearch.userName},
      
      We found ${
        matchingProperties.length
      } new properties that match your saved search.
      
      Matching Properties:
      ${matchingProperties
        .map(
          (property) => `
        - ${property.title}
        - KSh ${property.price.toLocaleString()}
        - ${property.type}
        - ${
          property.ward && property.constituency && property.county
            ? `${property.ward}, ${property.constituency}, ${property.county}`
            : property.location
        }
        - View: ${
          process.env.FRONTEND_URL || 'http://localhost:5173'
        }/listings/${property._id}
      `
        )
        .join('\n')}
      
      View all properties: ${
        process.env.FRONTEND_URL || 'http://localhost:5173'
      }/listings
      Manage your searches: ${
        process.env.FRONTEND_URL || 'http://localhost:5173'
      }/dashboard
    `

    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@zawamuproperties.com',
      to: savedSearch.userEmail,
      subject: subject,
      text: textContent,
      html: htmlContent,
    }

    // In development, we'll just log the email instead of actually sending it
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 EMAIL ALERT (Development Mode):')
      console.log('To:', savedSearch.userEmail)
      console.log('Subject:', subject)
      console.log('Properties:', matchingProperties.length)
      console.log('---')
      return { success: true, messageId: 'dev-mode-' + Date.now() }
    }

    const result = await transporter.sendMail(mailOptions)
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error('Error sending property alert email:', error)
    return { success: false, error: error.message }
  }
}

// Send multiple alerts
const sendPropertyAlerts = async (matches) => {
  const results = []

  for (const match of matches) {
    const { savedSearch, matchingProperties } = match

    // Check if we can send more alerts today
    if (
      savedSearch.alertsSentToday >= savedSearch.alertSettings.maxAlertsPerDay
    ) {
      console.log(
        `Skipping alert for ${savedSearch.userEmail} - daily limit reached`
      )
      continue
    }

    try {
      const result = await sendPropertyAlert(savedSearch, matchingProperties)

      if (result.success) {
        // Update the saved search with alert info
        savedSearch.lastAlertSent = new Date()
        savedSearch.totalAlertsSent += 1
        savedSearch.alertsSentToday += 1
        await savedSearch.save()

        results.push({
          savedSearchId: savedSearch._id,
          userEmail: savedSearch.userEmail,
          success: true,
          messageId: result.messageId,
          propertiesCount: matchingProperties.length,
        })
      } else {
        results.push({
          savedSearchId: savedSearch._id,
          userEmail: savedSearch.userEmail,
          success: false,
          error: result.error,
        })
      }
    } catch (error) {
      console.error(`Error sending alert to ${savedSearch.userEmail}:`, error)
      results.push({
        savedSearchId: savedSearch._id,
        userEmail: savedSearch.userEmail,
        success: false,
        error: error.message,
      })
    }
  }

  return results
}

export { sendPropertyAlert, sendPropertyAlerts }
