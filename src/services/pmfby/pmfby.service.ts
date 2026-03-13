import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class PmfbyService {
  private readonly logger = new Logger(PmfbyService.name);

  constructor(
    private readonly configService?: ConfigService,
  ) { }

  private getPassword(): string {
    return this.configService?.get<string>('PMFBY_PASSWORD') || process.env.PMFBY_PASSWORD;
  }

  private getBaseUrl(): string {
    return this.configService?.get<string>('PMFBY_BASE_URL') || process.env.PMFBY_BASE_URL;
  }

  /**
   * Build headers for PMFBY calls. Will use provided token or fallback to env/config or login token.
   */
  private async buildHeaders() {
    const password = this.getOtpPassword();

    const headers: Record<string, any> = {
      'Content-Type': 'application/json',
      'password': password,
      'token': await this.getPmfbyToken(),
    };

    return headers;
  }
  private getOtpPassword(): string {
    return this.configService?.get<string>('PMFBY_OTP_PASSWORD') || process.env.PMFBY_OTP_PASSWORD;
  }

  /**
   * Get PMFBY authentication token
   */
  async getPmfbyToken() {
    try {
      let config = {
        headers: {
          'Content-Type': 'application/json'
        },
        url: `${process.env.PMFBY_BASE_URL}/api/v2/external/service/login`,
        method: 'post',
        data: {
          "deviceType": "web",
          "mobile": process.env.PMFBY_MOBILE,
          "otp": 123456,
          "password": process.env.PMFBY_PASSWORD,
        }
      }
      const response = await axios.request(config);

      // Check if token exists in the expected location
      if (!response.data) {
        this.logger.error('No data in API response');
        throw new Error('Invalid token response from PMFBY service: No data returned');
      }


      const token = response.data.data.token

      if (!token) {
        this.logger.error('Token not found in API response', response.data);
        throw new Error('Invalid token response from PMFBY service: No token found');
      }

      return token;
    } catch (error) {
      this.logger.error(`Error getting PMFBY token: ${error.message}`);
      if (error.response) {
        this.logger.error('Error response:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      throw new Error(`Failed to get PMFBY token: ${error.message}`);
    }
  }

  /**
   * Get Farmer ID from mobile number
   */
  async getFarmerId(mobileNumber: string): Promise<string> {
    try {
      // Static authToken for demo purposes
      const authToken = process.env.PMFBY_AUTH_TOKEN;
      console.log("authToken--->>", authToken);
      const config = {
        url: `${process.env.PMFBY_BASE_URL}/api/v1/services/services/farmerMobileExists`,
        method: 'get',
        params: {
          mobile: mobileNumber,
          authToken: authToken
        }
      }
      console.log("getFarmerId config--->>", config);
      const response = await axios.request(config);
      console.log("getFarmerId response--->>", response.data);
      // Fix: Correctly access farmerID from the nested structure
      const farmerId = response?.data?.data?.result?.farmerID;

      if (!farmerId) {
        this.logger.error('Farmer ID not found in API response', response.data);
      }
      return farmerId;
    } catch (error) {
      this.logger.error(`Error fetching farmer ID: ${error.message}`);
    }
  }

  /**
   * Get Claim Status
   */
  async getClaimStatus(farmerId: string, season: string, year: string, token: string): Promise<any> {
    try {
      const config = {
        url: `${process.env.PMFBY_BASE_URL}/api/v1/claims/claims/claimSearchReport`,
        method: 'get',
        params: {
          season: season,
          year: year,
          farmerID: farmerId,
          searchType: 'farmerID'
        },
        headers: {
          'token': token
        }
      }

      const response = await axios.request(config);

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching claim status: ${error.message}`);
      throw new Error(`Failed to get claim status: ${error.message}`);
    }
  }

  /**
   * Get Policy Status
   */
  async getPolicyStatus(farmerId: string, season: string, year: string, token: string): Promise<any> {
    try {
      // Construct the sssyID as per requirements: 040${season}00${year}
      const sssyID = `040${season}00${year}`;
      console.log('sssyID---> ',sssyID); 
      const config = {
        url: `${process.env.PMFBY_BASE_URL}/api/v1/policy/policy/farmerpolicylist`,
        method: 'get',
        params: {
          listType: 'POLICY_LIST',
          farmerID: farmerId,
          sssyID: sssyID
        },
        headers: {
          'token': token
        }
      }
      const response = await axios.request(config);

      return response.data;
    } catch (error) {
      this.logger.error(`Error fetching policy status: ${error.message}`);
      throw new Error(`Failed to get policy status: ${error.message}`);
    }
  }

  /**
   * Test method to fetch weather data using the same axios pattern as PMKISAN
   */
  async testWeatherAPI(stationId: string): Promise<any> {
    try {
      this.logger.log(`Testing weather API call for station ID: ${stationId}`);
      
      const config = {
        method: 'get',
        url: `${process.env.IMD_WEATHER_API_URL}?id=${stationId}`,
        headers: {
          'Content-Type': 'application/json',
          'Accept': '*/*',
        },
        timeout: 30000, // 30 seconds timeout
      };
      
      this.logger.log('Weather API config:', JSON.stringify(config, null, 2));
      
      const response = await axios.request(config);
      
      this.logger.log(`Weather API response status: ${response.status}`);
      this.logger.log('Weather API response data:', JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error: any) {
      this.logger.error(`Error fetching weather data: ${error.message}`);
      if (error.response) {
        this.logger.error('Error response:', {
          status: error.response.status,
          data: error.response.data
        });
      }
      if (error.request) {
        this.logger.error('Request made but no response received');
      }
      if (error.code) {
        this.logger.error(`Error code: ${error.code}`);
      }
      throw new Error(`Failed to get weather data: ${error.message}`);
    }
  }

  /**
   * Request PMFBY to send OTP to a mobile number
   */
  async getOtp(mobile: string): Promise<{ success: true; message: string }> {

    console.log("getOtp mobile--->>", mobile);
    console.log("getOtp baseUrl--->>", this.getBaseUrl());
    console.log("getOtp headers--->>", await this.buildHeaders());


    const timeout = Number(this.configService?.get<number>('PMFBY_TIMEOUT')) || 20000;
    try {
      const data = { mobile, otpType: 'SMS' };
      const config = {
        method: 'post',
        url: `${this.getBaseUrl()}/api/v1/services/nic/getOtp`,
        headers: await this.buildHeaders(),
        timeout,
        data,
        maxBodyLength: Infinity,
      };

      const response = await axios.request(config);

      // PMFBY returns an object { status: boolean, data: ..., error: '' }
      if (!response || !response.data) {
        this.logger.error('Empty response from PMFBY getOtp');
        throw new HttpException('Empty response from PMFBY', HttpStatus.BAD_GATEWAY);
      }

      const resp = response.data;

      if (resp.status === false) {
        const message = resp.error || 'Failed to send OTP';
        this.logger.warn('PMFBY getOtp returned failure', { mobile, message, resp });
        throw new HttpException(message, HttpStatus.BAD_REQUEST);
      }

      // Success path
      const message = typeof resp.data === 'string' ? resp.data : resp.data?.message || 'OTP sent successfully';
      return { success: true, message };
    } catch (error: any) {
      this.logger.error('Error in getOtp', error?.message || error);
      throw new HttpException(error.response.data?.message || 'PMFBY service error', HttpStatus.BAD_GATEWAY);
    }
  }

  /**
   * Verify OTP against PMFBY
   */
  async verifyOtp(mobile: string, otp: string): Promise<{ verified: boolean; reason?: string }> {
    const timeout = Number(this.configService?.get<number>('PMFBY_TIMEOUT')) || 20000;
    try {
      // PMFBY verifyMobile expects otp as number
      const data = { mobile, otp: Number(otp) };
      const config = {
        method: 'post',
        url: `${this.getBaseUrl()}/api/v1/services/nic/verifyMobile`,
        headers: await this.buildHeaders(),
        timeout,
        data,
        maxBodyLength: Infinity,
      };

      const response = await axios.request(config);

      if (!response || !response.data) {
        this.logger.error('Empty response from PMFBY verifyMobile');
        throw new HttpException('Empty response from PMFBY', HttpStatus.BAD_GATEWAY);
      }

      const resp = response.data;

      if (resp.status === false) {
        const reason = resp.error || 'OTP verification failed';
        this.logger.warn('PMFBY verifyMobile returned failure', { mobile, reason, resp });
        return { verified: false, reason };
      }

      // resp.data may contain { verified: true }
      const verified = Boolean(resp.data?.verified === true || resp.data === true);

      return { verified };
    } catch (error: any) {
      this.logger.error('Error in verifyOtp', error?.message || error);
      throw new HttpException(error.response.data?.message || 'PMFBY service error', HttpStatus.BAD_GATEWAY);
    }
  }
  
} 