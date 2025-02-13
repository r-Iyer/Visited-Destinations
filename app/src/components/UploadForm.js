// src/components/UploadForm.js
import React, { useState, useEffect, useRef } from 'react';
import '../styles/uploadForm.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || '';
const CLOUD_NAME = process.env.REACT_APP_CLOUDINARY_CLOUD_NAME; // e.g. "mycloudname"
const UPLOAD_PRESET = process.env.REACT_APP_CLOUDINARY_UPLOAD_PRESET; // e.g. "unsigned_preset"

const UploadForm = ({ onUploadSuccess }) => {
  const [formData, setFormData] = useState({
    username: localStorage.getItem('username') || '',
    password: localStorage.getItem('password') || '',
    place: '',
    state: '',
    country: '',
    latlong: '',
    image: null,
  });
  const [message, setMessage] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isPasswordVerified, setIsPasswordVerified] = useState(localStorage.getItem('isVerified') === 'true');
  const [isUploading, setIsUploading] = useState(false);

  const placeInputRef = useRef(null);
  const autocompleteRef = useRef(null);

  // Helper function to initialize Google Places Autocomplete
  const initializeAutocomplete = () => {
    if (window.google && placeInputRef.current) {
      // Clear previous listeners if any.
      if (autocompleteRef.current) {
        window.google.maps.event.clearInstanceListeners(autocompleteRef.current);
      }
      autocompleteRef.current = new window.google.maps.places.Autocomplete(placeInputRef.current);
      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        if (place && place.address_components) {
          let state = '';
          let country = '';
          place.address_components.forEach(component => {
            if (component.types.includes('administrative_area_level_1')) {
              state = component.long_name;
            }
            if (component.types.includes('country')) {
              country = component.long_name;
            }
          });

          // If geometry is available, extract lat and lng
          let latlong = formData.latlong; // fallback if geometry is missing
          if (place.geometry && place.geometry.location) {
            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();
            latlong = `${lat}, ${lng}`;
          }

          setFormData(prevData => ({
            ...prevData,
            place: place.name || prevData.place,
            state,
            country,
            latlong,
          }));
        }
      });
    }
  };

  // Initialize autocomplete once on mount
  useEffect(() => {
    initializeAutocomplete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Additional effect: When the place field is cleared (after changing user), reinitialize autocomplete.
  useEffect(() => {
    if (isPasswordVerified && formData.place === '' && placeInputRef.current) {
      initializeAutocomplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.place, isPasswordVerified]);

  // Handle input changes (including file inputs)
  const handleChange = (e) => {
    const { name, value, files } = e.target;
    
    // If the user selects a new image, clear any previous message
    if (name === "image") {
      setMessage('');
    }
    
    // If the username is being changed while user is verified,
    // do not allow a different username to be entered.
    if (name === "username" && isPasswordVerified) {
      const currentStoredUsername = localStorage.getItem('username');
      if (value.trim().toLowerCase() !== currentStoredUsername) {
        setMessage('❌ To change username, please click on "Change User" first.');
        return;
      }
    }
  
    // Check file size (Max 10MB)
    if (files && files[0]) {
      if (files[0].size > 10 * 1024 * 1024) { // 10MB limit
        setMessage('❌ File size must be ≤ 10MB');
        e.target.value = null;
        return;
      }
    }
  
    setFormData(prevData => ({
      ...prevData,
      [name]: files ? files[0] : value,
    }));
  };

  // Verify password before allowing upload
  const verifyPassword = async () => {
    setMessage('');
    try {
      const response = await fetch(`${BACKEND_URL}/api/user/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username.trim().toLowerCase(),
          password: formData.password,
        }),
      });
      const result = await response.json();
      if (response.ok) {
        setIsPasswordVerified(true);
        const normalizedUsername = formData.username.trim().toLowerCase();
        localStorage.setItem('username', normalizedUsername);
        localStorage.setItem('password', formData.password);
        localStorage.setItem('isVerified', 'true');
        setMessage('✅ Password Verified! You can upload now.');
      } else {
        setIsPasswordVerified(false);
        setMessage(result.error || '❌ Incorrect password!');
      }
    } catch (error) {
      console.error('❌ Verification Error:', error);
      setMessage('❌ Error verifying password');
    }
  };

  // Handle form submission and perform an extra check for authorization by calling the backend.
  const handleSubmit = async (e) => {
    e.preventDefault();

    // Always verify credentials with the backend, regardless of local state.
    try {
      const verifyResponse = await fetch(`${BACKEND_URL}/api/user/verify-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formData.username.trim().toLowerCase(),
          password: formData.password,
        }),
      });
      const verifyResult = await verifyResponse.json();
      if (!verifyResponse.ok) {
        setMessage(verifyResult.error || '❌ Not authorized. Please verify your credentials.');
        return;
      }
    } catch (error) {
      console.error('❌ Error re-verifying credentials:', error);
      setMessage('❌ Error verifying credentials. Please try again.');
      return;
    }

    // Format the username (trim and capitalize first letter)
    const formattedUsername = formData.username.trim();
    const formattedUsernameCap = formattedUsername.charAt(0).toUpperCase() + formattedUsername.slice(1).toLowerCase();

    // Check if the user exists by calling the /api/user/list endpoint
    try {
      const listResponse = await fetch(`${BACKEND_URL}/api/user/list`);
      const listResult = await listResponse.json();
      if (!listResult.users || !listResult.users.includes(formattedUsernameCap)) {
        setMessage('❌ User does not exist. Please register first.');
        return;
      }
    } catch (error) {
      console.error('❌ Error fetching user list:', error);
      setMessage('❌ Error checking user existence');
      return;
    }

    // Validate and split latlong
    const [latitude, longitude] = formData.latlong.split(',').map(coord => coord.trim());
    if (!latitude || !longitude) {
      setMessage('❌ Invalid latitude/longitude');
      return;
    }

    setIsUploading(true);
    // Create FormData for Cloudinary upload
    const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/upload`;
    const cloudinaryData = new FormData();
    cloudinaryData.append('file', formData.image);
    cloudinaryData.append('upload_preset', UPLOAD_PRESET);

    try {
      let secureUrl = '';
      if (formData.image) {
        // Upload file directly to Cloudinary
        const cloudinaryResponse = await fetch(cloudinaryUrl, {
          method: 'POST',
          body: cloudinaryData,
        });
        const cloudinaryResult = await cloudinaryResponse.json();

        if (!cloudinaryResult.secure_url) {
          setMessage('❌ Cloudinary upload failed.');
          setIsUploading(false);
          return;
        }

        console.log("✅ Image Uploaded Successfully to Cloudinary:", cloudinaryResult.secure_url);
        secureUrl = cloudinaryResult.secure_url;
      }

      // Prepare metadata (including Cloudinary URL) to send to your backend
      const metadataData = new FormData();
      metadataData.append('username', formData.username);
      metadataData.append('place', formData.place);
      metadataData.append('state', formData.state);
      metadataData.append('country', formData.country);
      metadataData.append('latitude', latitude);
      metadataData.append('longitude', longitude);
      metadataData.append('imageUrl', secureUrl);

      // Call endpoint to save metadata in MongoDB
      const metadataResponse = await fetch(`${BACKEND_URL}/api/upload/metadata`, {
        method: 'POST',
        body: metadataData,
      });
      const metadataResult = await metadataResponse.json();

      if (metadataResponse.ok) {
        setMessage('✅ New Destination Unlocked!');
        setImageUrl(metadataResult.imageUrl);
        if (onUploadSuccess) {
          setTimeout(() => {
            onUploadSuccess();
          }, 1500);
        }
      } else {
        setMessage(metadataResult.error || '❌ Please try again!');
      }
    } catch (error) {
      console.error('❌ Upload Error:', error);
      setMessage('❌ Error uploading file');
    } finally {
      setIsUploading(false);
    }
  };

  // Handler to change user: clears stored credentials, resets form data, and reinitializes autocomplete.
  const handleChangeUser = () => {
    localStorage.removeItem('username');
    localStorage.removeItem('password');
    localStorage.removeItem('isVerified');
    setIsPasswordVerified(false);
    setFormData({
      username: '',
      password: '',
      place: '',
      state: '',
      country: '',
      latlong: '',
      image: null,
    });
    setMessage('');
    // Reinitialize autocomplete after a brief delay to ensure the DOM has updated.
    setTimeout(() => {
      initializeAutocomplete();
    }, 300);
  };

  return (
    <div className="upload-form-container">
      <h2 className="upload-form-title">Upload a New Destination</h2>
      <form onSubmit={handleSubmit} className="upload-form">
        <label className="upload-form-label">User:</label>
        <input
          type="text"
          name="username"
          placeholder="Enter your username"
          value={formData.username}
          onChange={handleChange}
          required
          className="upload-form-input"
        />

        <label className="upload-form-label">Password:</label>
        <input
          type="password"
          name="password"
          placeholder="Enter your password"
          value={formData.password}
          onChange={handleChange}
          required
          className="upload-form-input"
          disabled={isPasswordVerified}  // Password field becomes non-modifiable after verification
        />

        {!isPasswordVerified && (
          <button
            type="button"
            onClick={verifyPassword}
            className="verify-password-button"
          >
            Verify Password
          </button>
        )}

        {/* If the user is verified, display the Change User button above the destination fields */}
        {isPasswordVerified && formData.username && formData.password && (
          <button
            type="button"
            className="toggle-change-user-button"
            onClick={handleChangeUser}
          >
            Change User
          </button>
        )}

        {isPasswordVerified && (
          <>
            <label className="upload-form-label">Place:</label>
            <input
              type="text"
              name="place"
              placeholder="Enter place"
              ref={placeInputRef}
              value={formData.place}
              onChange={handleChange}
              required
              className="upload-form-input"
            />

            <label className="upload-form-label">State:</label>
            <input
              type="text"
              name="state"
              placeholder="State (auto-filled)"
              value={formData.state}
              onChange={handleChange}
              className="upload-form-input"
            />

            <label className="upload-form-label">Country:</label>
            <input
              type="text"
              name="country"
              placeholder="Country (auto-filled)"
              value={formData.country}
              onChange={handleChange}
              className="upload-form-input"
            />

            <label className="upload-form-label">Latitude, Longitude:</label>
            <input
              type="text"
              name="latlong"
              placeholder="e.g. 23.233, 77.321"
              value={formData.latlong}
              onChange={handleChange}
              required
              className="upload-form-input"
            />

            <label className="upload-form-label">Image:</label>
            <input
              type="file"
              name="image"
              accept="image/*"
              onChange={handleChange}
              className="upload-form-input"
            />

            <button
              type="submit"
              className="upload-form-button"
              disabled={isUploading}
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </button>
          </>
        )}
      </form>

      {message && <p className="upload-form-message">{message}</p>}
      {imageUrl && (
        <div className="upload-form-image-container">
          <img src={imageUrl} alt="Uploaded" className="upload-form-image" />
        </div>
      )}
    </div>
  );
};

export default UploadForm;
