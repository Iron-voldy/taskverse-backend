import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { JwtService } from '@nestjs/jwt'
import { ConfigService } from '@nestjs/config'
import { Model } from 'mongoose'
import * as argon2 from 'argon2'
import { OAuth2Client } from 'google-auth-library'
import { User, UserDocument } from '../common/schemas/user.schema'

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client
  private readonly googleClientId: string

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {
    this.googleClientId = this.config.getOrThrow<string>('GOOGLE_CLIENT_ID')
    this.googleClient = new OAuth2Client(this.googleClientId)
  }

  async register(email: string, password: string, name: string) {
    const existing = await this.userModel.findOne({ email: email.toLowerCase() })
    if (existing) throw new ConflictException('Email already in use')
    const passwordHash = await argon2.hash(password)
    const user = await this.userModel.create({ email: email.toLowerCase(), passwordHash, name })
    const token = this.signToken(user)
    return { user: this.sanitize(user), token }
  }

  async login(email: string, password: string) {
    const user = await this.userModel.findOne({ email: email.toLowerCase() })
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials')
    const valid = await argon2.verify(user.passwordHash, password)
    if (!valid) throw new UnauthorizedException('Invalid credentials')
    await this.updateStreak(user)
    return { user: this.sanitize(user), token: this.signToken(user) }
  }

  async googleAuth(idToken: string) {
    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: this.googleClientId,
    })
    const payload = ticket.getPayload()
    if (!payload?.email || payload.email.trim() === '') throw new UnauthorizedException('Invalid Google token')

    let user = await this.userModel.findOne({ email: payload.email })
    if (!user) {
      user = await this.userModel.create({
        email: payload.email,
        name: payload.name ?? payload.email.split('@')[0],
        googleId: payload.sub,
        image: payload.picture,
        emailVerified: true,
      })
    } else if (!user.googleId) {
      user.googleId = payload.sub
      if (payload.picture) user.image = payload.picture
      await user.save()
    }

    await this.updateStreak(user)
    return { user: this.sanitize(user), token: this.signToken(user) }
  }

  private signToken(user: UserDocument): string {
    return this.jwtService.sign({ sub: user._id.toString(), email: user.email })
  }

  private sanitize(user: UserDocument) {
    const obj = user.toObject() as unknown as Record<string, unknown>
    delete obj.passwordHash
    return obj
  }

  private async updateStreak(user: UserDocument) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const last = user.lastActiveDate ? new Date(user.lastActiveDate) : null

    if (last) {
      const lastDay = new Date(last)
      lastDay.setHours(0, 0, 0, 0)
      if (lastDay < yesterday) {
        user.streak = 1
      } else if (lastDay.getTime() === yesterday.getTime()) {
        user.streak = (user.streak ?? 0) + 1
      }
    } else {
      user.streak = 1
    }
    user.lastActiveDate = new Date()
    await user.save()
  }
}
